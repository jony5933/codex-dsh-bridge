import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateRunReport } from "../src/report.js";

function blockedResult(): Record<string, unknown> {
  return {
    version: 1,
    runId: "run-1",
    taskId: "task-1",
    status: "blocked",
    repository: "/repo",
    baseCommit: "abc123",
    branch: "deepseek-loop/run-1",
    worktree: "/worktree",
    startedAt: "2026-08-21T00:00:00.000Z",
    completedAt: "2026-08-21T00:00:01.000Z",
    harness: null,
    baselineChecks: [{}],
    checks: [],
    acceptanceChecks: [],
    skills: null,
    gitPolicy: null,
    boundary: { changedFiles: [], allowedFiles: [], violations: [] },
    patchPath: null,
    reportPath: "/artifacts/result.json",
    blockers: ["Baseline checks failed before Harness execution."],
    failureReasons: [],
    lineage: {},
  };
}

describe("Runner result schema", () => {
  it("accepts a blocked result without execution artifacts", async () => {
    const result = await validateRunReport(blockedResult());
    assert.equal(result.status, "blocked");
  });

  it("rejects a blocked result that claims to contain a patch", async () => {
    await assert.rejects(
      validateRunReport({ ...blockedResult(), patchPath: "/artifacts/changes.patch" }),
      /patchPath.*must be null/,
    );
  });

  it("rejects a non-blocked result with blockers", async () => {
    await assert.rejects(
      validateRunReport({ ...blockedResult(), status: "failed" }),
      /blockers.*must NOT have more than 0 items/,
    );
  });

  it("requires failure reasons only for failed results", async () => {
    const executed = {
      ...blockedResult(),
      status: "failed",
      harness: {},
      skills: {},
      gitPolicy: {},
      patchPath: "/artifacts/changes.patch",
      blockers: [],
    };
    await assert.rejects(validateRunReport(executed), /failureReasons.*must NOT have fewer/);
    await assert.rejects(
      validateRunReport({
        ...executed,
        status: "passed",
        failureReasons: ["不应存在的失败原因"],
      }),
      /failureReasons.*must NOT have more/,
    );
  });
});
