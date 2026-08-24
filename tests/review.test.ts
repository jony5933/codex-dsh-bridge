import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { recordReviewArtifact, validateReviewArtifact } from "../src/review.js";
import type { ReviewArtifact, RunReport } from "../src/types.js";

function createReport(
  root: string,
  status: "passed" | "failed" | "blocked" = "passed",
): RunReport {
  const blocked = status === "blocked";
  return {
    version: 1,
    runId: "review-run-1",
    taskId: "review-task",
    status,
    repository: root,
    baseCommit: "abc123",
    branch: "deepseek-loop/review-run-1",
    worktree: join(root, "worktree"),
    startedAt: new Date(0).toISOString(),
    completedAt: new Date(1).toISOString(),
    harness: blocked
      ? null
      : {
          command: "fake",
          args: [],
          cwd: root,
          exitCode: 0,
          signal: null,
          stdout: "",
          stderr: "",
          durationMs: 1,
          timedOut: false,
        },
    baselineChecks: [],
    checks: [],
    acceptanceChecks: [],
    skills: blocked
      ? null
      : {
          isolated: false,
          enabled: false,
          invocation: null,
          sourceRoot: null,
          stagedRoot: null,
          patchPath: null,
          patchSha256: null,
          bundles: [],
          verified: true,
          violations: [],
        },
    gitPolicy: blocked
      ? null
      : {
          wrapperPath: join(root, "git"),
          logPath: join(root, "attempts.jsonl"),
          wrapperSha256: "a".repeat(64),
          blockedCommands: [],
          startingHead: "abc123",
          finalHead: "abc123",
          refChanges: [],
          verified: true,
          violations: [],
        },
    boundary: { changedFiles: [], allowedFiles: [], violations: [] },
    patchPath: blocked ? null : join(root, "changes.patch"),
    reportPath: join(root, "artifacts", "result.json"),
    blockers: blocked ? ["baseline 环境不可用"] : [],
    failureReasons: status === "failed" ? ["Harness process failed."] : [],
    lineage: {
      contractPath: join(root, "contract.json"),
      rootContractPath: join(root, "contract.json"),
      iteration: 0,
      findings: [],
      history: [],
    },
  };
}

function createReview(overrides: Partial<ReviewArtifact> = {}): ReviewArtifact {
  return {
    version: 1,
    runId: "review-run-1",
    taskId: "review-task",
    status: "approved",
    summary: "检查和边界均通过，没有未解决问题。",
    findings: [],
    blockers: [],
    ...overrides,
  };
}

describe("review artifacts", () => {
  it("validates an approved review against a passed report", async () => {
    const root = await mkdtemp(join(tmpdir(), "deepseek-review-"));
    const review = await validateReviewArtifact(createReview(), createReport(root));
    assert.equal(review.status, "approved");
  });

  it("enforces status semantics and report identity", async () => {
    const root = await mkdtemp(join(tmpdir(), "deepseek-review-"));
    const openFinding = {
      id: "response-contract",
      severity: "P2" as const,
      title: "保持响应 Contract",
      file: "src/controller.ts",
      startLine: null,
      endLine: null,
      evidence: "当前返回值缺少原始字段。",
      minimalFix: "恢复原始响应字段并补充回归测试。",
      resolution: "open" as const,
    };
    const changesRequested = await validateReviewArtifact(
      createReview({
        status: "changes-requested",
        findings: [openFinding],
      }),
      createReport(root),
    );
    assert.equal(changesRequested.findings[0]?.startLine, null);

    await assert.rejects(
      validateReviewArtifact(createReview(), createReport(root, "failed")),
      /requires passed execution evidence/,
    );
    await assert.rejects(
      validateReviewArtifact(
        createReview({ status: "changes-requested", findings: [openFinding] }),
        createReport(root, "blocked"),
      ),
      /can only produce a blocked review/,
    );
    const blocked = await validateReviewArtifact(
      createReview({ status: "blocked", blockers: ["baseline 环境不可用"] }),
      createReport(root, "blocked"),
    );
    assert.equal(blocked.status, "blocked");
    await assert.rejects(
      validateReviewArtifact(
        createReview({ status: "changes-requested" }),
        createReport(root),
      ),
      /requires at least one open finding/,
    );
    await assert.rejects(
      validateReviewArtifact(createReview({ runId: "wrong-run" }), createReport(root)),
      /does not match report/,
    );
  });

  it("records a validated review outside the worktree", async () => {
    const root = await mkdtemp(join(tmpdir(), "deepseek-review-"));
    const worktree = join(root, "worktree");
    const artifacts = join(root, "artifacts");
    await mkdir(worktree);
    await mkdir(artifacts);
    const report = createReport(root);
    const reportPath = join(artifacts, "result.json");
    const candidatePath = join(root, "candidate.json");
    await writeFile(reportPath, JSON.stringify(report));
    await writeFile(candidatePath, JSON.stringify(createReview()));

    const recorded = await recordReviewArtifact(reportPath, candidatePath);

    assert.equal(recorded.review.status, "approved");
    assert.equal(recorded.reviewPath, join(await realpath(artifacts), "review.json"));
    assert.deepEqual(
      JSON.parse(await readFile(recorded.reviewPath, "utf8")),
      createReview(),
    );
    await assert.rejects(
      recordReviewArtifact(reportPath, candidatePath),
      /EEXIST/,
    );
  });

  it("rejects a review candidate written inside the worktree", async () => {
    const root = await mkdtemp(join(tmpdir(), "deepseek-review-"));
    const worktree = join(root, "worktree");
    const artifacts = join(root, "artifacts");
    await mkdir(worktree);
    await mkdir(artifacts);
    const reportPath = join(artifacts, "result.json");
    const candidatePath = join(worktree, "review.json");
    await writeFile(reportPath, JSON.stringify(createReport(root)));
    await writeFile(candidatePath, JSON.stringify(createReview()));

    await assert.rejects(
      recordReviewArtifact(reportPath, candidatePath),
      /must be created outside the execution worktree/,
    );
  });
});
