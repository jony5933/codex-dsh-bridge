import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  runCodexReviewAdapter,
  type CodexReviewAdapterOptions,
} from "../src/reviewer/codex-cli.js";
import type { CommandResult, ContractLineage, RunReport } from "../src/types.js";

function commandResult(): CommandResult {
  return {
    command: "fake",
    args: [],
    cwd: "/tmp",
    exitCode: 0,
    signal: null,
    stdout: "",
    stderr: "",
    durationMs: 1,
    timedOut: false,
  };
}

async function createFixture(): Promise<{
  root: string;
  reportPath: string;
  fakeCli: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "deepseek-codex-review-"));
  const worktree = join(root, "worktree");
  const artifacts = join(root, "artifacts");
  await mkdir(worktree);
  await mkdir(artifacts);
  const contractPath = join(root, "contract.json");
  await writeFile(
    contractPath,
    JSON.stringify({
      version: 1,
      taskId: "review-task",
      repository: worktree,
      baseCommit: "abc123",
      objective: "审阅一个确定性的 fake CLI 变更结果。",
      allowedPaths: ["src/**"],
      forbiddenPaths: ["package.json"],
      acceptanceCriteria: ["保持既有行为"],
      requiredChecks: ["npm test"],
      instructions: "禁止扩大修改范围。",
    }),
  );
  const lineage: ContractLineage = {
    contractPath,
    rootContractPath: contractPath,
    iteration: 0,
    findings: [],
    history: [],
  };
  const patchPath = join(artifacts, "changes.patch");
  const reportPath = join(artifacts, "result.json");
  await writeFile(patchPath, "diff --git a/src/a.ts b/src/a.ts\n");
  const report: RunReport = {
    version: 1,
    runId: "review-run-1",
    taskId: "review-task",
    status: "passed",
    repository: worktree,
    baseCommit: "abc123",
    branch: "deepseek-loop/review-run-1",
    worktree,
    startedAt: new Date(0).toISOString(),
    completedAt: new Date(1).toISOString(),
    harness: commandResult(),
    baselineChecks: [],
    checks: [],
    acceptanceChecks: [],
    skills: {
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
    gitPolicy: {
      wrapperPath: join(artifacts, "git-policy", "git"),
      logPath: join(artifacts, "git-policy", "attempts.jsonl"),
      wrapperSha256: "a".repeat(64),
      blockedCommands: [],
      startingHead: "abc123",
      finalHead: "abc123",
      refChanges: [],
      verified: true,
      violations: [],
    },
    boundary: { changedFiles: ["src/a.ts"], allowedFiles: ["src/a.ts"], violations: [] },
    patchPath,
    reportPath,
    blockers: [],
    failureReasons: [],
    lineage,
  };
  await writeFile(reportPath, JSON.stringify(report));

  const fakeCli = join(root, "fake-codex.mjs");
  await writeFile(
    fakeCli,
    `import { writeFileSync } from "node:fs";
const [scenario, ...args] = process.argv.slice(2);
let prompt = "";
for await (const chunk of process.stdin) prompt += chunk;
if (process.env.OPENAI_API_KEY || process.env.DEEPSEEK_API_KEY) process.exit(8);
if (!prompt.includes("Codex 独立审阅协议") || !prompt.includes("review-run-1")) process.exit(7);
const outputIndex = args.indexOf("--output-last-message");
const candidatePath = args[outputIndex + 1];
const review = { version: 1, runId: "review-run-1", taskId: "review-task", status: "approved", summary: "fake review 通过。", findings: [], blockers: [] };
const completed = { type: "turn.completed", usage: { input_tokens: 100, cached_input_tokens: 20, output_tokens: 10, reasoning_output_tokens: 5 } };
if (scenario === "timeout") { setInterval(() => {}, 1000); }
else if (scenario === "nonzero") { process.stderr.write("fake failure\\n"); process.exit(9); }
else if (scenario === "malformed-jsonl") { writeFileSync(candidatePath, JSON.stringify(review)); process.stdout.write("not-json\\n"); }
else if (scenario === "missing-completion") { writeFileSync(candidatePath, JSON.stringify(review)); process.stdout.write(JSON.stringify({ type: "thread.started" }) + "\\n"); }
else if (scenario === "invalid-candidate") { writeFileSync(candidatePath, "{}"); process.stdout.write(JSON.stringify(completed) + "\\n"); }
else { writeFileSync(candidatePath, JSON.stringify(review)); process.stdout.write(JSON.stringify({ type: "thread.started" }) + "\\n" + JSON.stringify(completed) + "\\n"); }
`,
  );
  return { root, reportPath, fakeCli };
}

function options(fakeCli: string, scenario: string): CodexReviewAdapterOptions {
  return {
    enabled: true,
    command: process.execPath,
    argsPrefix: [fakeCli, scenario],
    timeoutMs: scenario === "timeout" ? 100 : 10_000,
    environment: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      OPENAI_API_KEY: "must-not-reach-reviewer",
      DEEPSEEK_API_KEY: "must-not-reach-reviewer",
    },
  };
}

describe("Codex review adapter", () => {
  it("is disabled unless explicitly enabled", async () => {
    const fixture = await createFixture();
    await assert.rejects(
      runCodexReviewAdapter(fixture.reportPath, {
        ...options(fixture.fakeCli, "success"),
        enabled: false,
      }),
      /adapter is disabled/,
    );
  });

  it("does not start model review for a blocked Runner report", async () => {
    const fixture = await createFixture();
    const report = JSON.parse(await readFile(fixture.reportPath, "utf8")) as RunReport;
    await writeFile(
      fixture.reportPath,
      JSON.stringify({
        ...report,
        status: "blocked",
        harness: null,
        checks: [],
        acceptanceChecks: [],
        skills: null,
        gitPolicy: null,
        patchPath: null,
        blockers: ["baseline 环境不可用"],
        boundary: { changedFiles: [], allowedFiles: [], violations: [] },
      }),
    );

    await assert.rejects(
      runCodexReviewAdapter(fixture.reportPath, options(fixture.fakeCli, "success")),
      /cannot run for blocked execution evidence without a patch/,
    );
  });

  it("records a successful structured review and usage", async () => {
    const fixture = await createFixture();
    const result = await runCodexReviewAdapter(
      fixture.reportPath,
      options(fixture.fakeCli, "success"),
    );

    assert.equal(result.execution.status, "passed");
    assert.equal(result.review?.status, "approved");
    assert.deepEqual(result.execution.usage, {
      inputTokens: 100,
      cachedInputTokens: 20,
      outputTokens: 10,
      reasoningOutputTokens: 5,
    });
    assert.equal(result.execution.command?.args.includes("--ephemeral"), true);
    assert.equal(result.execution.command?.args.includes("--ignore-user-config"), true);
    assert.equal(result.execution.command?.args.includes("--ignore-rules"), true);
    assert.equal(result.execution.command?.args.includes("read-only"), true);
    assert.equal(result.execution.reviewPath?.startsWith(await realpath(fixture.root)), true);
    assert.equal(
      JSON.parse(await readFile(result.execution.executionReportPath, "utf8")).status,
      "passed",
    );
  });

  it("reviews schema-validated direct-channel evidence", async () => {
    const fixture = await createFixture();
    const runner = JSON.parse(await readFile(fixture.reportPath, "utf8")) as RunReport;
    const directPath = join(fixture.root, "artifacts", "direct-evidence.json");
    await writeFile(
      directPath,
      JSON.stringify({
        version: 1,
        kind: "direct-channel",
        runId: runner.runId,
        taskId: runner.taskId,
        status: "passed",
        repository: runner.repository,
        baseCommit: runner.baseCommit,
        worktree: runner.worktree,
        startedAt: runner.startedAt,
        completedAt: runner.completedAt,
        contractPath: runner.lineage.contractPath,
        harness: {
          exitCode: 0,
          timedOut: false,
          durationMs: 1,
          stdoutPath: join(fixture.root, "artifacts", "stdout.log"),
          stderrPath: join(fixture.root, "artifacts", "stderr.log"),
        },
        baselineChecks: [],
        checks: [],
        acceptanceChecks: [],
        boundary: { ...runner.boundary, verification: "manual" },
        patchPath: runner.patchPath,
        evidencePath: directPath,
        blockers: [],
        failureReasons: [],
        controls: {
          isolatedWorktree: true,
          gitPolicy: false,
          automatedChecks: false,
          automatedBoundaryCheck: false,
        },
      }),
    );

    const result = await runCodexReviewAdapter(directPath, options(fixture.fakeCli, "success"));

    assert.equal(result.execution.status, "passed");
    assert.match(await readFile(result.execution.promptPath, "utf8"), /"channel": "direct"/);
    assert.match(await readFile(result.execution.promptPath, "utf8"), /# Execution evidence/);
  });

  for (const scenario of [
    "nonzero",
    "timeout",
    "malformed-jsonl",
    "missing-completion",
    "invalid-candidate",
  ]) {
    it(`fails closed for ${scenario}`, async () => {
      const fixture = await createFixture();
      const result = await runCodexReviewAdapter(
        fixture.reportPath,
        options(fixture.fakeCli, scenario),
      );

      assert.equal(result.execution.status, "failed");
      assert.equal(result.review, undefined);
      assert.equal(result.execution.reviewPath, null);
      assert.ok(result.execution.failureReasons.length > 0);
      if (scenario === "timeout") assert.equal(result.execution.command?.timedOut, true);
      await assert.rejects(readFile(join(fixture.root, "artifacts", "review.json"), "utf8"));
    });
  }
});
