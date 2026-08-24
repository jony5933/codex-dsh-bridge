import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { WebHostClient } from "../src/harness/web-host/client.js";
import {
  WebHostTransport,
  type WebHostTransportRequest,
} from "../src/harness/web-host/transport.js";
import {
  WebHostSessionError,
  type WebHostSessionRequest,
  type WebHostSessionResult,
} from "../src/harness/web-host/session.js";

const client = { endpoint: "http://127.0.0.1:3080" } as WebHostClient;

function request(mode: "web-direct" | "web-guarded"): WebHostTransportRequest {
  return {
    mode,
    executionPath: "/project",
    prompt: "请修改代码，并保留必要的 technical terms。",
    timeoutMs: 30_000,
    cancelTimeoutMs: 2_000,
    maxReconnects: 2,
    agentPreset: "default",
  };
}

function completedSession(sessionId: string): WebHostSessionResult {
  return {
    outcome: "completed",
    endpoint: "http://127.0.0.1:3080",
    host: {
      version: "0.1.0-rc.8",
      cwd: "/project",
      attachedSessions: 1,
      home: "/home/test",
      canOpenPath: true,
    },
    workspaceId: "workspace-1",
    workspacePath: "/project",
    workspaceCreated: false,
    reconnects: 1,
    sessionId,
    promptAccepted: true,
    baselineLastSeq: 3,
    terminalSeq: 6,
    terminalReason: "completed",
    sawRunning: true,
    finalRunning: false,
  };
}

describe("WebHostTransport", () => {
  it("returns native Web Host evidence without inventing a process exit code", async () => {
    const calls: WebHostSessionRequest[] = [];
    const times = [new Date("2026-08-21T00:00:00.000Z"), new Date("2026-08-21T00:00:01.250Z")];
    const transport = new WebHostTransport({
      client,
      createSessionId: () => "session-1",
      now: () => times.shift()!,
      runSession: async (_client, sessionRequest) => {
        calls.push(sessionRequest);
        return completedSession(sessionRequest.sessionId);
      },
    });

    const evidence = await transport.execute(request("web-direct"));

    assert.equal(transport.kind, "web-host");
    assert.equal(evidence.status, "completed");
    assert.equal(evidence.durationMs, 1_250);
    assert.equal(evidence.session?.workspaceId, "workspace-1");
    assert.equal("exitCode" in evidence, false);
    assert.equal("timedOut" in evidence, false);
    assert.deepEqual(calls, [
      {
        sessionId: "session-1",
        workspacePath: "/project",
        prompt: "请修改代码，并保留必要的 technical terms。",
        timeoutMs: 30_000,
        cancelTimeoutMs: 2_000,
        maxReconnects: 2,
        agentPreset: "default",
      },
    ]);
    assert.equal(evidence.capabilities.postRunChecks, "not-requested");
  });

  it("marks guarded controls as caller-required and unsupported injection honestly", async () => {
    const transport = new WebHostTransport({
      client,
      createSessionId: () => "session-2",
      runSession: async (_client, sessionRequest) => completedSession(sessionRequest.sessionId),
    });

    const evidence = await transport.execute(request("web-guarded"));

    assert.equal(evidence.capabilities.processEnvironment, false);
    assert.equal(evidence.capabilities.skillPatch, false);
    assert.equal(evidence.capabilities.gitCommandWrapper, false);
    assert.equal(evidence.capabilities.postRunGitRefAudit, "caller-required");
    assert.equal(evidence.capabilities.postRunChecks, "caller-required");
    assert.equal(evidence.capabilities.postRunBoundaryCheck, "caller-required");
    assert.equal(evidence.capabilities.postRunArtifacts, "caller-required");
  });

  it("normalizes protocol failures without a fake exit code", async () => {
    const transport = new WebHostTransport({
      client,
      createSessionId: () => "session-3",
      runSession: async () => {
        throw new WebHostSessionError("sequence-gap", "Expected seq 4, received 5.");
      },
    });

    const evidence = await transport.execute(request("web-direct"));

    assert.equal(evidence.status, "failed");
    assert.equal(evidence.session, null);
    assert.deepEqual(evidence.error, {
      name: "WebHostSessionError",
      code: "sequence-gap",
      message: "Expected seq 4, received 5.",
    });
    assert.equal("exitCode" in evidence, false);
  });

  it("maps unresolved interaction to blocked instead of completed", async () => {
    const transport = new WebHostTransport({
      client,
      createSessionId: () => "session-4",
      runSession: async () => {
        throw new WebHostSessionError("interaction-required", "Approval is required.");
      },
    });

    const evidence = await transport.execute(request("web-direct"));

    assert.equal(evidence.status, "blocked");
    assert.equal(evidence.error?.code, "interaction-required");
  });
});
