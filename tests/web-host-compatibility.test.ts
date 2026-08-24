import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import type {
  WebHostDownlink,
  WebHostRpcMethod,
  WebHostStream,
} from "../src/harness/web-host/client.js";
import {
  persistWebHostCompatibilityEvidence,
  probeWebHostCompatibility,
} from "../src/harness/web-host/compatibility.js";

class FakeCompatibilityClient {
  readonly endpoint = "http://127.0.0.1:3080";
  readonly calls: string[] = [];
  hostVersion = "0.0.1";
  rejectStream: WebHostStream | null = null;
  hangStream: WebHostStream | null = null;

  async call<T>(method: WebHostRpcMethod): Promise<T> {
    this.calls.push(method);
    if (method === "host.describe") {
      return {
        version: this.hostVersion,
        cwd: "/project",
        attachedSessions: 1,
        home: "/home/test",
        canOpenPath: true,
        provider: "deepseek-official",
        model: "deepseek-v4-flash",
      } as T;
    }
    if (method === "workspace.list") {
      return {
        items: [
          {
            workspaceId: "workspace-1",
            path: "/project",
            title: "Project",
            sessionIds: ["session-1"],
            createdAt: "2026-08-21T00:00:00.000Z",
            updatedAt: "2026-08-21T00:00:00.000Z",
          },
        ],
        archivedSessionIds: [],
      } as T;
    }
    if (method === "session.list") {
      return { items: [{ sessionId: "session-1", running: false }] } as T;
    }
    throw new Error(`Compatibility probe attempted a mutating RPC: ${method}`);
  }

  openDownlink(stream: WebHostStream, signal: AbortSignal): WebHostDownlink {
    this.calls.push(`events.${stream}`);
    const opened = this.hangStream === stream
      ? new Promise<void>(() => undefined)
      : this.rejectStream === stream
        ? Promise.reject(new Error(`${stream} is unavailable`))
        : Promise.resolve();
    const closed = new Promise<void>((resolve) => {
      signal.addEventListener("abort", () => resolve(), { once: true });
      if (signal.aborted) resolve();
    });
    return {
      url: `ws://127.0.0.1:3080/api/events.${stream}`,
      opened,
      closed,
      close: () => undefined,
    };
  }
}

function versionObservation(version: string) {
  return async () => ({
    command: "dsh",
    version,
    exitCode: 0,
    timedOut: false,
    error: null,
  });
}

describe("Web Host compatibility probe", () => {
  it("accepts a verified DSH version only after all read-only RPC and downlink checks pass", async () => {
    const client = new FakeCompatibilityClient();
    const evidence = await probeWebHostCompatibility(client, {
      cwd: "/project",
      now: () => new Date("2026-08-24T02:00:00.000Z"),
      readDshVersion: versionObservation("0.1.1-rc.1"),
    });

    assert.equal(evidence.status, "compatible");
    assert.equal(evidence.host.protocolVersion, "0.0.1");
    assert.equal(evidence.dsh.sameProcessAsHost, "unverified");
    assert.deepEqual(client.calls, [
      "host.describe",
      "workspace.list",
      "session.list",
      "events.mux",
      "events.host",
    ]);
    assert.equal(evidence.checks.every((check) => check.status === "passed"), true);
    assert.deepEqual(evidence.mutations, {
      workspaceCreated: false,
      sessionCreated: false,
      promptSent: false,
    });
  });

  it("probes an unknown future version read-only but keeps the version blocked", async () => {
    const client = new FakeCompatibilityClient();
    const evidence = await probeWebHostCompatibility(client, {
      cwd: "/project",
      readDshVersion: versionObservation("0.1.1-rc.3"),
    });

    assert.equal(evidence.status, "incompatible");
    assert.match(evidence.failureReasons[0] ?? "", /not in the verified compatibility set/);
    assert.deepEqual(client.calls, [
      "host.describe",
      "workspace.list",
      "session.list",
      "events.mux",
      "events.host",
    ]);
    assert.equal(
      evidence.checks
        .filter((check) => check.id !== "dsh-cli-version")
        .every((check) => check.status === "passed"),
      true,
    );
    assert.deepEqual(evidence.dsh.knownUnverifiedVersions, []);
  });

  it("fails closed for an unknown Host protocol marker before reading mutable surfaces", async () => {
    const client = new FakeCompatibilityClient();
    client.hostVersion = "0.0.2";
    const evidence = await probeWebHostCompatibility(client, {
      cwd: "/project",
      readDshVersion: versionObservation("0.1.1-rc.1"),
    });

    assert.equal(evidence.status, "incompatible");
    assert.match(evidence.failureReasons[0] ?? "", /Unsupported Web Host protocol marker/);
    assert.deepEqual(client.calls, ["host.describe"]);
  });

  it("fails closed when either required WebSocket downlink cannot open", async () => {
    const client = new FakeCompatibilityClient();
    client.rejectStream = "host";
    const evidence = await probeWebHostCompatibility(client, {
      cwd: "/project",
      readDshVersion: versionObservation("0.1.0-rc.8"),
    });

    assert.equal(evidence.status, "incompatible");
    assert.equal(
      evidence.checks.find((check) => check.id === "host-downlink")?.status,
      "failed",
    );
  });

  it("bounds compatibility downlink setup with a fail-closed timeout", async () => {
    const client = new FakeCompatibilityClient();
    client.hangStream = "mux";
    const evidence = await probeWebHostCompatibility(client, {
      cwd: "/project",
      downlinkTimeoutMs: 5,
      readDshVersion: versionObservation("0.1.1-rc.2"),
    });

    assert.equal(evidence.status, "incompatible");
    assert.match(evidence.failureReasons[0] ?? "", /timed out/);
  });

  it("persists immutable compatibility evidence beside the planned run", async () => {
    const root = await mkdtemp(join(tmpdir(), "web-host-compatibility-"));
    const artifacts = join(root, "artifacts");
    await mkdir(artifacts);
    const evidence = await probeWebHostCompatibility(new FakeCompatibilityClient(), {
      cwd: "/project",
      now: () => new Date("2026-08-24T02:00:00.000Z"),
      readDshVersion: versionObservation("0.1.1-rc.1"),
    });

    const persisted = await persistWebHostCompatibilityEvidence(
      evidence,
      artifacts,
      "planned-session-1",
    );
    const saved = JSON.parse(await readFile(persisted.probePath, "utf8")) as {
      plannedSessionId: string;
      status: string;
    };

    assert.equal(saved.plannedSessionId, "planned-session-1");
    assert.equal(saved.status, "compatible");
    assert.match(
      persisted.probePath,
      /2026-08-24\/planned-session-1\/compatibility\.json$/,
    );
    await assert.rejects(
      persistWebHostCompatibilityEvidence(evidence, artifacts, "planned-session-1"),
      /EEXIST/,
    );
  });
});
