import { access, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ErrorObject } from "ajv";
import { validateRunReport } from "./report.js";
import type { BoundaryResult, RunReport } from "./types.js";

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

interface Validator {
  (data: unknown): boolean;
  errors?: ErrorObject[] | null;
}
interface AjvInstance { compile(schema: object): Validator }
type AjvConstructor = new (options: Record<string, unknown>) => AjvInstance;
const Ajv2020 = (require("ajv/dist/2020").default ?? require("ajv/dist/2020")) as AjvConstructor;

interface DirectCheckEvidence {
  check: string;
  exitCode: number | null;
  timedOut: boolean;
  logPath: string;
}

interface DirectAcceptanceEvidence {
  id: string;
  exitCode: number | null;
  timedOut: boolean;
  logPath: string;
}

export interface DirectExecutionEvidence {
  version: 1;
  kind: "direct-channel";
  runId: string;
  taskId: string;
  status: "passed" | "failed" | "blocked";
  repository: string;
  baseCommit: string;
  worktree: string;
  startedAt: string;
  completedAt: string;
  contractPath: string;
  harness: null | { exitCode: number | null; timedOut: boolean; durationMs: number; stdoutPath: string; stderrPath: string };
  baselineChecks: DirectCheckEvidence[];
  checks: DirectCheckEvidence[];
  acceptanceChecks: DirectAcceptanceEvidence[];
  boundary: BoundaryResult & { verification: "manual" };
  patchPath: string | null;
  evidencePath: string;
  blockers: string[];
  failureReasons: string[];
  controls: { isolatedWorktree: true; gitPolicy: false; automatedChecks: false; automatedBoundaryCheck: false };
}

export interface ReviewEvidence {
  channel: "runner" | "direct";
  runId: string;
  taskId: string;
  status: "passed" | "failed" | "blocked";
  repository: string;
  baseCommit: string;
  worktree: string;
  contractPath: string;
  artifactPath: string;
  patchPath: string | null;
  blockers: string[];
  failureReasons: string[];
  baselineChecks: Array<{ check: string; exitCode: number | null; timedOut: boolean }>;
  harness: null | { exitCode: number | null; timedOut: boolean };
  checks: Array<{ check: string; exitCode: number | null; timedOut: boolean }>;
  acceptanceChecks: Array<{ id: string; exitCode: number | null; timedOut: boolean }>;
  boundary: BoundaryResult;
  controls: Record<string, boolean>;
}

async function findDirectEvidenceSchemaPath(): Promise<string> {
  const candidates = [
    resolve(moduleDirectory, "../contracts/direct-evidence.schema.json"),
    resolve(moduleDirectory, "../../contracts/direct-evidence.schema.json"),
  ];
  for (const candidate of candidates) {
    try { await access(candidate); return candidate; } catch { /* Try build layout. */ }
  }
  throw new Error("Cannot locate contracts/direct-evidence.schema.json");
}

export async function validateDirectExecutionEvidence(raw: unknown): Promise<DirectExecutionEvidence> {
  const schema = JSON.parse(await readFile(await findDirectEvidenceSchemaPath(), "utf8")) as object;
  const validate = new Ajv2020({ allErrors: true, strict: false }).compile(schema);
  if (!validate(raw)) {
    const details = (validate.errors ?? []).map((error) => `${error.instancePath || "/"} ${error.message ?? "is invalid"}`).join("\n");
    throw new Error(`Invalid direct-channel evidence:\n${details}`);
  }
  return raw as DirectExecutionEvidence;
}

export function normalizeRunReport(report: RunReport): ReviewEvidence {
  return {
    channel: "runner", runId: report.runId, taskId: report.taskId, status: report.status,
    repository: report.repository, baseCommit: report.baseCommit, worktree: report.worktree,
    contractPath: report.lineage.contractPath, artifactPath: report.reportPath,
    patchPath: report.patchPath, blockers: report.blockers, failureReasons: report.failureReasons,
    baselineChecks: report.baselineChecks, harness: report.harness, checks: report.checks,
    acceptanceChecks: report.acceptanceChecks, boundary: report.boundary,
    controls: { isolatedWorktree: true, gitPolicy: report.gitPolicy?.verified ?? false, automatedChecks: true, automatedBoundaryCheck: true },
  };
}

function normalizeDirectEvidence(evidence: DirectExecutionEvidence): ReviewEvidence {
  return {
    channel: "direct", runId: evidence.runId, taskId: evidence.taskId, status: evidence.status,
    repository: evidence.repository, baseCommit: evidence.baseCommit, worktree: evidence.worktree,
    contractPath: evidence.contractPath, artifactPath: evidence.evidencePath,
    patchPath: evidence.patchPath, blockers: evidence.blockers, failureReasons: evidence.failureReasons,
    baselineChecks: evidence.baselineChecks, harness: evidence.harness, checks: evidence.checks,
    acceptanceChecks: evidence.acceptanceChecks, boundary: evidence.boundary,
    controls: evidence.controls,
  };
}

export async function loadReviewEvidence(raw: unknown): Promise<ReviewEvidence> {
  if (typeof raw === "object" && raw !== null && (raw as { kind?: unknown }).kind === "direct-channel") {
    return normalizeDirectEvidence(await validateDirectExecutionEvidence(raw));
  }
  return normalizeRunReport(await validateRunReport(raw));
}
