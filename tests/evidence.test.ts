import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadReviewEvidence, validateDirectExecutionEvidence } from "../src/evidence.js";

function directEvidence(): Record<string, unknown> {
  return {
    version: 1,
    kind: "direct-channel",
    runId: "direct-1",
    taskId: "task-1",
    status: "passed",
    repository: "/repo",
    baseCommit: "abc123",
    worktree: "/worktree",
    startedAt: "2026-08-21T00:00:00.000Z",
    completedAt: "2026-08-21T00:00:01.000Z",
    contractPath: "/contracts/task.json",
    harness: {
      exitCode: 0,
      timedOut: false,
      durationMs: 1000,
      stdoutPath: "/artifacts/stdout.log",
      stderrPath: "/artifacts/stderr.log",
    },
    baselineChecks: [],
    checks: [{ check: "npm test", exitCode: 0, timedOut: false, logPath: "/artifacts/test.log" }],
    acceptanceChecks: [],
    boundary: {
      changedFiles: ["src/a.js"],
      allowedFiles: ["src/a.js"],
      violations: [],
      verification: "manual",
    },
    patchPath: "/artifacts/changes.patch",
    evidencePath: "/artifacts/direct-evidence.json",
    blockers: [],
    failureReasons: [],
    controls: {
      isolatedWorktree: true,
      gitPolicy: false,
      automatedChecks: false,
      automatedBoundaryCheck: false,
    },
  };
}

describe("direct-channel evidence", () => {
  it("validates and normalizes direct evidence without inventing Runner controls", async () => {
    const evidence = await loadReviewEvidence(directEvidence());
    assert.equal(evidence.channel, "direct");
    assert.deepEqual(evidence.controls, {
      isolatedWorktree: true,
      gitPolicy: false,
      automatedChecks: false,
      automatedBoundaryCheck: false,
    });
  });

  it("rejects claims that the direct channel used Runner Git policy", async () => {
    const raw = directEvidence();
    raw.controls = {
      isolatedWorktree: true,
      gitPolicy: true,
      automatedChecks: false,
      automatedBoundaryCheck: false,
    };
    await assert.rejects(validateDirectExecutionEvidence(raw), /gitPolicy.*must be equal to constant/);
  });
});
