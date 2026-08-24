import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { prepareAcceptanceChecks, runAcceptanceCheck } from "./acceptance.js";
import { loadContract } from "./contract.js";
import { checkBoundaries } from "./git/boundary.js";
import { prepareGitPolicy, verifyGitPolicy } from "./git/policy.js";
import {
  assertGitRepository,
  createPatch,
  listChangedFiles,
  resolveCommit,
} from "./git/repository.js";
import { createWorktree } from "./git/worktree.js";
import { buildExecutionPrompt, HeadlessTransport } from "./harness/headless.js";
import { runShellCheck } from "./lib/command.js";
import { validateRunReport } from "./report.js";
import { prepareSkills, verifySkillProjection } from "./skills.js";
import type {
  AcceptanceCheckResult,
  CheckResult,
  RunEvent,
  RunPhase,
  RunReport,
  RunTaskOptions,
} from "./types.js";

function createRunId(taskId: string): string {
  const timestamp = new Date().toISOString().replaceAll(/[-:.TZ]/g, "");
  return `${taskId}-${timestamp}`;
}

function emit(options: RunTaskOptions, phase: RunPhase, message: string): void {
  const event: RunEvent = { timestamp: new Date().toISOString(), phase, message };
  options.onEvent?.(event);
}

export async function runTask(
  contractPath: string,
  options: RunTaskOptions = {},
): Promise<RunReport> {
  const startedAt = new Date();
  emit(options, "preparing", `Loading task contract: ${contractPath}`);
  const contract = await loadContract(contractPath);
  const repository = await assertGitRepository(contract.repository);
  const baseCommit = await resolveCommit(repository, contract.baseCommit);
  const runId = createRunId(contract.taskId);
  const worktree = await createWorktree(
    repository,
    baseCommit,
    runId,
    contract.execution.worktreeRoot,
  );
  emit(options, "preparing", `Created isolated worktree: ${worktree.path}`);
  const preparedAcceptanceChecks = await prepareAcceptanceChecks(
    contract.acceptanceChecks,
    contract.lineage,
    repository,
    worktree.path,
  );
  const artifactDirectory = join(dirname(worktree.path), ".artifacts", runId);
  await mkdir(artifactDirectory, { recursive: true });
  const baselineChecks: CheckResult[] = [];
  for (const check of contract.baselineChecks) {
    emit(options, "checking", `Running baseline check: ${check}`);
    const result = await runShellCheck(check, worktree.path);
    baselineChecks.push({ ...result, check });
    emit(
      options,
      "checking",
      `Baseline check exited with code ${result.exitCode ?? "null"}: ${check}`,
    );
  }
  if (baselineChecks.some((check) => check.exitCode !== 0)) {
    const reportPath = join(artifactDirectory, "result.json");
    const report: RunReport = {
      version: 1,
      runId,
      taskId: contract.taskId,
      status: "blocked",
      repository,
      baseCommit,
      branch: worktree.branch,
      worktree: worktree.path,
      startedAt: startedAt.toISOString(),
      completedAt: new Date().toISOString(),
      harness: null,
      baselineChecks,
      checks: [],
      acceptanceChecks: [],
      skills: null,
      gitPolicy: null,
      boundary: { changedFiles: [], allowedFiles: [], violations: [] },
      patchPath: null,
      reportPath,
      blockers: ["Baseline checks failed before Harness execution."],
      failureReasons: [],
      lineage: contract.lineage,
    };
    await validateRunReport(report);
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    emit(options, "complete", `Run blocked by baseline checks: ${reportPath}`);
    return report;
  }
  const preparedSkills = await prepareSkills(
    contract.skills,
    contract.lineage,
    repository,
    worktree.path,
    artifactDirectory,
  );
  const preparedGitPolicy = await prepareGitPolicy(artifactDirectory, worktree.path);
  const prompt = await buildExecutionPrompt(contract, baseCommit);
  await writeFile(join(artifactDirectory, "prompt.md"), prompt, "utf8");
  const harnessTransport = options.harnessTransport ?? new HeadlessTransport();
  emit(options, "harness", `Starting DSH: ${contract.harness.command}`);
  const harness = await harnessTransport.execute({
    contract,
    worktree: worktree.path,
    prompt,
    skillPatch: preparedSkills.patchPath,
    output: {
      env: { ...preparedSkills.environment, ...preparedGitPolicy.environment },
      onStdout: options.onHarnessStdout,
      onStderr: options.onHarnessStderr,
    },
  });
  emit(
    options,
    "harness",
    `DSH exited with code ${harness.exitCode ?? "null"} after ${harness.durationMs} ms`,
  );
  await writeFile(join(artifactDirectory, "harness.stdout.log"), harness.stdout, "utf8");
  await writeFile(join(artifactDirectory, "harness.stderr.log"), harness.stderr, "utf8");
  const skillViolations = await verifySkillProjection(preparedSkills.audit);
  preparedSkills.audit.verified = skillViolations.length === 0;
  preparedSkills.audit.violations = skillViolations;
  const gitPolicyViolations = await verifyGitPolicy(preparedGitPolicy, worktree.path);

  const checks: CheckResult[] = [];
  for (const check of contract.requiredChecks) {
    emit(options, "checking", `Running required check: ${check}`);
    const result = await runShellCheck(check, worktree.path);
    checks.push({ ...result, check });
    emit(options, "checking", `Check exited with code ${result.exitCode ?? "null"}: ${check}`);
  }

  const acceptanceChecks: AcceptanceCheckResult[] = [];
  for (const prepared of preparedAcceptanceChecks) {
    emit(options, "checking", `Running independent acceptance check: ${prepared.config.id}`);
    const result = await runAcceptanceCheck(prepared, worktree.path);
    acceptanceChecks.push(result);
    emit(
      options,
      "checking",
      `Acceptance check exited with code ${result.exitCode ?? "null"}: ${result.id}`,
    );
  }

  emit(options, "verification", "Inspecting changed paths and creating patch artifacts");
  const changedFiles = await listChangedFiles(worktree.path, baseCommit);
  const boundary = checkBoundaries(
    changedFiles.filter((path) => !path.startsWith(".deepseek-loop/")),
    contract.allowedPaths,
    contract.forbiddenPaths,
  );
  const patch = await createPatch(worktree.path, baseCommit);
  const patchPath = join(artifactDirectory, "changes.patch");
  const reportPath = join(artifactDirectory, "result.json");
  await writeFile(patchPath, patch, "utf8");

  const failureReasons: string[] = [];
  if (harness.exitCode !== 0) failureReasons.push("Harness process failed.");
  if (harness.timedOut) failureReasons.push("Harness process timed out.");
  if (checks.some((check) => check.exitCode !== 0)) failureReasons.push("One or more checks failed.");
  if (acceptanceChecks.some((check) => check.exitCode !== 0)) {
    failureReasons.push("One or more independent acceptance checks failed.");
  }
  if (boundary.violations.length) failureReasons.push("Path-boundary violations were detected.");
  if (skillViolations.length) failureReasons.push("Skill projection integrity violations were detected.");
  if (gitPolicyViolations.length) failureReasons.push("Git policy violations were detected.");

  const report: RunReport = {
    version: 1,
    runId,
    taskId: contract.taskId,
    status: failureReasons.length ? "failed" : "passed",
    repository,
    baseCommit,
    branch: worktree.branch,
    worktree: worktree.path,
    startedAt: startedAt.toISOString(),
    completedAt: new Date().toISOString(),
    harness,
    baselineChecks,
    checks,
    acceptanceChecks,
    skills: preparedSkills.audit,
    gitPolicy: preparedGitPolicy.audit,
    boundary,
    patchPath,
    reportPath,
    blockers: [],
    failureReasons,
    lineage: contract.lineage,
  };
  await validateRunReport(report);
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  emit(options, "complete", `Run ${report.status}: ${report.reportPath}`);
  return report;
}
