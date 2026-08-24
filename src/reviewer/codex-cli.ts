import { access, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadContract } from "../contract.js";
import { loadReviewEvidence, type ReviewEvidence } from "../evidence.js";
import { createCheckEnvironment, runCommand } from "../lib/command.js";
import { findReviewSchemaPath, recordReviewArtifact } from "../review.js";
import type {
  CodexReviewExecutionReport,
  CommandResult,
  ReviewArtifact,
  ReviewUsage,
} from "../types.js";

const moduleDirectory = dirname(fileURLToPath(import.meta.url));

export interface CodexReviewAdapterOptions {
  enabled: boolean;
  command: string;
  argsPrefix?: string[];
  timeoutMs?: number;
  environment?: NodeJS.ProcessEnv;
}

export interface CodexReviewAdapterResult {
  execution: CodexReviewExecutionReport;
  review?: ReviewArtifact;
}

interface ParsedJsonl {
  usage: ReviewUsage | null;
  failureReasons: string[];
}

async function findReviewerProtocolPath(): Promise<string> {
  const candidates = [
    resolve(moduleDirectory, "../../prompts/reviewer.md"),
    resolve(moduleDirectory, "../../../prompts/reviewer.md"),
  ];
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next source/build layout.
    }
  }
  throw new Error("Cannot locate prompts/reviewer.md");
}

export function createReviewerEnvironment(
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const environment = createCheckEnvironment(source);
  if (source.CODEX_HOME !== undefined) environment.CODEX_HOME = source.CODEX_HOME;
  environment.NO_COLOR = "1";
  return environment;
}

function parseUsage(raw: unknown): ReviewUsage | null {
  if (typeof raw !== "object" || raw === null) return null;
  const usage = raw as Record<string, unknown>;
  const values = [
    usage.input_tokens,
    usage.cached_input_tokens,
    usage.output_tokens,
    usage.reasoning_output_tokens,
  ];
  if (!values.every((value) => typeof value === "number" && value >= 0)) return null;
  return {
    inputTokens: usage.input_tokens as number,
    cachedInputTokens: usage.cached_input_tokens as number,
    outputTokens: usage.output_tokens as number,
    reasoningOutputTokens: usage.reasoning_output_tokens as number,
  };
}

function parseJsonl(stdout: string): ParsedJsonl {
  const failureReasons: string[] = [];
  let completed = false;
  let usage: ReviewUsage | null = null;
  const lines = stdout.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) return { usage: null, failureReasons: ["Codex JSONL output was empty."] };

  for (const [index, line] of lines.entries()) {
    let event: Record<string, unknown>;
    try {
      const raw = JSON.parse(line) as unknown;
      if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
        throw new Error("event is not an object");
      }
      event = raw as Record<string, unknown>;
    } catch (error) {
      failureReasons.push(
        `Codex JSONL line ${index + 1} is invalid: ${error instanceof Error ? error.message : String(error)}`,
      );
      continue;
    }

    if (event.type === "error" || event.type === "turn.failed") {
      failureReasons.push(`Codex emitted terminal failure event: ${String(event.type)}`);
    }
    if (event.type === "turn.completed") {
      completed = true;
      usage = parseUsage(event.usage);
      if (usage === null) failureReasons.push("Codex turn.completed event has invalid usage.");
    }
  }

  if (!completed) failureReasons.push("Codex JSONL output is missing turn.completed.");
  return { usage, failureReasons };
}

async function buildReviewerPrompt(report: ReviewEvidence): Promise<string> {
  const protocol = await readFile(await findReviewerProtocolPath(), "utf8");
  const contract = await loadContract(report.contractPath);
  const evidence = {
    task: {
      taskId: contract.taskId,
      objective: contract.objective,
      baseCommit: report.baseCommit,
      allowedPaths: contract.allowedPaths,
      forbiddenPaths: contract.forbiddenPaths,
      acceptanceCriteria: contract.acceptanceCriteria,
      baselineChecks: contract.baselineChecks,
      requiredChecks: contract.requiredChecks,
      acceptanceCheckIds: contract.acceptanceChecks.map((check) => check.id),
      lineage: contract.lineage,
    },
    execution: {
      channel: report.channel,
      runId: report.runId,
      status: report.status,
      blockers: report.blockers ?? [],
      failureReasons: report.failureReasons,
      controls: report.controls,
      baselineChecks: report.baselineChecks.map((check) => ({
        check: check.check,
        exitCode: check.exitCode,
        timedOut: check.timedOut,
      })),
      harness:
        report.harness === null
          ? null
          : { exitCode: report.harness.exitCode, timedOut: report.harness.timedOut },
      checks: report.checks.map((check) => ({
        check: check.check,
        exitCode: check.exitCode,
        timedOut: check.timedOut,
      })),
      acceptanceChecks: report.acceptanceChecks.map((check) => ({
        id: check.id,
        exitCode: check.exitCode,
        timedOut: check.timedOut,
      })),
      boundary: report.boundary,
    },
    paths: {
      worktree: report.worktree,
      evidence: report.artifactPath,
      patch: report.patchPath,
    },
  };
  return `${protocol}\n\n# Execution evidence\n\n\`\`\`json\n${JSON.stringify(evidence, null, 2)}\n\`\`\`\n`;
}

function createAttemptId(): string {
  const timestamp = new Date().toISOString().replaceAll(/[-:.TZ]/g, "");
  return `${timestamp}-${randomUUID()}`;
}

async function writeExecutionReport(
  path: string,
  report: CodexReviewExecutionReport,
): Promise<void> {
  await writeFile(path, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

export async function runCodexReviewAdapter(
  reportPath: string,
  options: CodexReviewAdapterOptions,
): Promise<CodexReviewAdapterResult> {
  if (!options.enabled) throw new Error("Codex review adapter is disabled");
  const startedAt = new Date();
  const absoluteReportPath = await realpath(resolve(reportPath));
  const report = await loadReviewEvidence(JSON.parse(await readFile(absoluteReportPath, "utf8")) as unknown);
  if (report.status === "blocked") {
    throw new Error("Codex review cannot run for blocked execution evidence without a patch");
  }
  const worktree = await realpath(report.worktree);
  const artifactDirectory = await realpath(dirname(absoluteReportPath));
  const attemptDirectory = join(artifactDirectory, `codex-review-${createAttemptId()}`);
  await mkdir(attemptDirectory);

  const promptPath = join(attemptDirectory, "prompt.md");
  const stdoutPath = join(attemptDirectory, "stdout.jsonl");
  const stderrPath = join(attemptDirectory, "stderr.log");
  const candidatePath = join(attemptDirectory, "candidate.json");
  const executionReportPath = join(attemptDirectory, "execution.json");
  const prompt = await buildReviewerPrompt(report);
  await writeFile(promptPath, prompt, "utf8");

  const schemaPath = await findReviewSchemaPath();
  const codexArgs = [
    "--ask-for-approval",
    "never",
    "--cd",
    worktree,
    "exec",
    "--ephemeral",
    "--ignore-user-config",
    "--ignore-rules",
    "--sandbox",
    "read-only",
    "--output-schema",
    schemaPath,
    "--json",
    "--output-last-message",
    candidatePath,
    "-",
  ];
  const args = [...(options.argsPrefix ?? []), ...codexArgs];
  let command: CommandResult | null = null;
  let review: ReviewArtifact | undefined;
  let reviewPath: string | null = null;
  const failureReasons: string[] = [];
  let usage: ReviewUsage | null = null;

  try {
    command = await runCommand(options.command, args, {
      cwd: worktree,
      timeoutMs: options.timeoutMs ?? 900_000,
      stdin: prompt,
      env: createReviewerEnvironment(options.environment ?? process.env),
    });
    await writeFile(stdoutPath, command.stdout, "utf8");
    await writeFile(stderrPath, command.stderr, "utf8");

    if (command.timedOut) failureReasons.push("Codex review process timed out.");
    if (command.exitCode !== 0) {
      failureReasons.push(`Codex review process exited with code ${command.exitCode ?? "null"}.`);
    }
    const parsed = parseJsonl(command.stdout);
    usage = parsed.usage;
    failureReasons.push(...parsed.failureReasons);

    if (failureReasons.length === 0) {
      try {
        const recorded = await recordReviewArtifact(absoluteReportPath, candidatePath);
        review = recorded.review;
        reviewPath = recorded.reviewPath;
      } catch (error) {
        failureReasons.push(
          `Codex review candidate was rejected: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  } catch (error) {
    failureReasons.push(
      `Codex review process could not start: ${error instanceof Error ? error.message : String(error)}`,
    );
    await writeFile(stdoutPath, command?.stdout ?? "", "utf8");
    await writeFile(stderrPath, command?.stderr ?? "", "utf8");
  }

  const execution: CodexReviewExecutionReport = {
    status: failureReasons.length === 0 ? "passed" : "failed",
    startedAt: startedAt.toISOString(),
    completedAt: new Date().toISOString(),
    command,
    usage,
    promptPath,
    stdoutPath,
    stderrPath,
    candidatePath,
    executionReportPath,
    reviewPath,
    failureReasons,
  };
  await writeExecutionReport(executionReportPath, execution);
  return review === undefined ? { execution } : { execution, review };
}
