import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  parseWebProbeArguments,
  parseWebRunArguments,
  persistWebHostEvidence,
  prepareWebHostArtifactRoot,
} from "../src/harness/web-host/command.js";
import {
  parseWebRunQueryArguments,
  queryWebHostRuns,
} from "../src/harness/web-host/index.js";
import type { WebHostTransportEvidence } from "../src/harness/web-host/transport.js";

function evidence(executionPath: string): WebHostTransportEvidence {
  return {
    version: 1,
    kind: "web-host",
    mode: "web-direct",
    status: "completed",
    executionPath,
    sessionId: "session-test-1",
    startedAt: "2026-08-21T09:00:00.000Z",
    completedAt: "2026-08-21T09:00:01.000Z",
    durationMs: 1_000,
    session: null,
    error: null,
    capabilities: {
      workspaceGrouping: true,
      liveEvents: true,
      processEnvironment: false,
      skillPatch: false,
      gitCommandWrapper: false,
      postRunGitRefAudit: "not-requested",
      postRunChecks: "not-requested",
      postRunBoundaryCheck: "not-requested",
      postRunArtifacts: "not-requested",
    },
  };
}

describe("web-run command support", () => {
  it("parses persistent defaults and explicit overrides", () => {
    assert.deepEqual(parseWebRunArguments(["/project", "/prompt.md"], "/home/test"), {
      projectPath: "/project",
      promptPath: "/prompt.md",
      endpoint: "http://127.0.0.1:3080",
      timeoutMs: 1_800_000,
      artifactRoot: "/home/test/.dsh-bridge/runs",
    });
    assert.deepEqual(
      parseWebRunArguments([
        "/project",
        "/prompt.md",
        "--endpoint",
        "http://localhost:4080",
        "--timeout-ms",
        "120000",
        "--artifact-root",
        "/evidence",
      ]),
      {
        projectPath: "/project",
        promptPath: "/prompt.md",
        endpoint: "http://localhost:4080",
        timeoutMs: 120_000,
        artifactRoot: "/evidence",
      },
    );
  });

  it("parses read-only compatibility probe arguments", () => {
    assert.deepEqual(parseWebProbeArguments(["/project"], "/home/test"), {
      projectPath: "/project",
      endpoint: "http://127.0.0.1:3080",
      artifactRoot: "/home/test/.dsh-bridge/runs",
    });
    assert.deepEqual(
      parseWebProbeArguments([
        "/project",
        "--endpoint",
        "http://localhost:4080",
        "--artifact-root",
        "/evidence",
      ]),
      {
        projectPath: "/project",
        endpoint: "http://localhost:4080",
        artifactRoot: "/evidence",
      },
    );
    assert.throws(() => parseWebProbeArguments([]), /requires/);
    assert.throws(
      () => parseWebProbeArguments(["/project", "--timeout-ms", "100"]),
      /Unknown/,
    );
  });

  it("rejects malformed, duplicate, and excessive options", () => {
    assert.throws(() => parseWebRunArguments(["/project"], "/home/test"), /requires/);
    assert.throws(
      () => parseWebRunArguments(["/project", "/prompt.md", "--unknown", "x"]),
      /Unknown/,
    );
    assert.throws(
      () =>
        parseWebRunArguments([
          "/project",
          "/prompt.md",
          "--timeout-ms",
          "100",
          "--timeout-ms",
          "200",
        ]),
      /Duplicate/,
    );
    assert.throws(
      () => parseWebRunArguments(["/project", "/prompt.md", "--timeout-ms", "86400001"]),
      /between/,
    );
  });

  it("persists evidence outside the project without shell redirection", async () => {
    const root = await mkdtemp(join(tmpdir(), "web-host-command-"));
    const project = join(root, "project");
    const artifacts = join(root, "artifacts");
    await mkdir(project);

    const persisted = await persistWebHostEvidence(evidence(project), artifacts);
    const saved = JSON.parse(await readFile(persisted.evidencePath, "utf8")) as {
      compatibilityProbePath: string | null;
      evidencePath: string;
      indexPath: string;
      sessionId: string;
    };

    assert.equal(saved.compatibilityProbePath, null);
    assert.equal(saved.evidencePath, persisted.evidencePath);
    assert.equal(saved.indexPath, persisted.indexPath);
    assert.equal(saved.sessionId, "session-test-1");
    assert.match(persisted.evidencePath, /2026-08-21\/session-test-1\/evidence\.json$/);
    assert.match(persisted.indexPath, /index\/2026-08-21\/session-test-1\.json$/);
  });

  it("rejects artifact roots inside the target project before creating them", async () => {
    const root = await mkdtemp(join(tmpdir(), "web-host-command-"));
    const project = join(root, "project");
    await mkdir(project);
    await assert.rejects(
      prepareWebHostArtifactRoot(project, join(project, ".evidence", "runs")),
      /outside the target project/,
    );
  });

  it("queries immutable run records by project, Workspace, session, status, and time", async () => {
    const root = await mkdtemp(join(tmpdir(), "web-host-command-"));
    const project = join(root, "project");
    const otherProject = join(root, "other-project");
    const artifacts = join(root, "artifacts");
    await mkdir(project);
    await mkdir(otherProject);

    const completed = evidence(project);
    completed.session = {
      outcome: "completed",
      endpoint: "http://127.0.0.1:3080",
      host: {
        version: "0.0.1",
        cwd: project,
        attachedSessions: 1,
        home: root,
        canOpenPath: true,
      },
      workspaceId: "workspace-1",
      workspacePath: project,
      workspaceCreated: false,
      reconnects: 0,
      sessionId: completed.sessionId,
      promptAccepted: true,
      baselineLastSeq: 0,
      terminalSeq: 2,
      terminalReason: "completed",
      sawRunning: true,
      finalRunning: false,
    };
    await persistWebHostEvidence(completed, artifacts);
    await persistWebHostEvidence(
      {
        ...evidence(otherProject),
        sessionId: "session-test-2",
        status: "failed",
        startedAt: "2026-08-22T09:00:00.000Z",
        completedAt: "2026-08-22T09:00:01.000Z",
      },
      artifacts,
    );

    const query = parseWebRunQueryArguments([
      "--artifact-root",
      artifacts,
      "--project",
      project,
      "--workspace",
      "workspace-1",
      "--session",
      "session-test-1",
      "--status",
      "completed",
      "--since",
      "2026-08-21T00:00:00Z",
      "--until",
      "2026-08-21T23:59:59Z",
      "--limit",
      "10",
    ]);
    const result = await queryWebHostRuns(query);

    assert.equal(result.count, 1);
    assert.equal(result.runs[0]?.projectPath, await realpath(project));
    assert.equal(result.runs[0]?.workspaceId, "workspace-1");
    assert.equal(result.runs[0]?.sessionId, "session-test-1");
    assert.equal(result.runs[0]?.status, "completed");
  });

  it("keeps a missing run index query read-only", async () => {
    const root = await mkdtemp(join(tmpdir(), "web-host-command-"));
    const missing = join(root, "missing-artifacts");
    const result = await queryWebHostRuns({ artifactRoot: missing, limit: 50 });

    assert.deepEqual(result.runs, []);
    await assert.rejects(readFile(join(missing, "index")), /ENOENT/);
  });

  it("does not leave evidence behind when its immutable index cannot be published", async () => {
    const root = await mkdtemp(join(tmpdir(), "web-host-command-"));
    const project = join(root, "project");
    const artifacts = join(root, "artifacts");
    const indexDirectory = join(artifacts, "index", "2026-08-21");
    await mkdir(project);
    await mkdir(indexDirectory, { recursive: true });
    await writeFile(join(indexDirectory, "session-test-1.json"), "occupied\n");

    await assert.rejects(persistWebHostEvidence(evidence(project), artifacts), /EEXIST/);
    await assert.rejects(
      readFile(join(artifacts, "2026-08-21", "session-test-1", "evidence.json")),
      /ENOENT/,
    );
  });

  it("rejects invalid run query filters", () => {
    assert.throws(() => parseWebRunQueryArguments(["--status", "passed"]), /status/);
    assert.throws(() => parseWebRunQueryArguments(["--limit", "0"]), /limit/);
    assert.throws(
      () =>
        parseWebRunQueryArguments([
          "--since",
          "2026-08-22T00:00:00Z",
          "--until",
          "2026-08-21T00:00:00Z",
        ]),
      /later/,
    );
  });
});
