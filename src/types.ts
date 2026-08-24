import type { HarnessTransport } from "./harness/transport.js";

export interface HarnessConfig {
  command: string;
  args: string[];
  timeoutMs: number;
}

export interface ExecutionConfig {
  worktreeRoot?: string;
  keepWorktree: boolean;
}

export interface AcceptanceCheckConfig {
  id: string;
  runner: "node" | "shell";
  script: string;
  args: string[];
  timeoutMs: number;
}

export interface SkillConfig {
  root?: string;
  names: string[];
  invocation: "automatic" | "explicit";
}

export interface SkillBundleAudit {
  name: string;
  sourcePath: string;
  sha256: string;
  fileCount: number;
}

export interface SkillAudit {
  isolated: boolean;
  enabled: boolean;
  invocation: "automatic" | "explicit" | null;
  sourceRoot: string | null;
  stagedRoot: string | null;
  patchPath: string | null;
  patchSha256: string | null;
  bundles: SkillBundleAudit[];
  verified: boolean;
  violations: string[];
}

export type ReviewSeverity = "P0" | "P1" | "P2" | "P3";
export type ReviewStatus = "approved" | "changes-requested" | "blocked";
export type FindingResolution = "open" | "resolved";

export interface ReviewFinding {
  id: string;
  severity: ReviewSeverity;
  title: string;
  description: string;
}

export interface CodeReviewFinding {
  id: string;
  severity: ReviewSeverity;
  title: string;
  file: string;
  startLine: number | null;
  endLine: number | null;
  evidence: string;
  minimalFix: string;
  resolution: FindingResolution;
}

export interface ReviewArtifact {
  version: 1;
  runId: string;
  taskId: string;
  status: ReviewStatus;
  summary: string;
  findings: CodeReviewFinding[];
  blockers: string[];
}

export interface ReviewUsage {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
}

export interface CodexReviewExecutionReport {
  status: "passed" | "failed";
  startedAt: string;
  completedAt: string;
  command: CommandResult | null;
  usage: ReviewUsage | null;
  promptPath: string;
  stdoutPath: string;
  stderrPath: string;
  candidatePath: string;
  executionReportPath: string;
  reviewPath: string | null;
  failureReasons: string[];
}

export interface ReviewIteration {
  iteration: number;
  findings: ReviewFinding[];
}

export interface ContractLineage {
  contractPath: string;
  rootContractPath: string;
  parentContractPath?: string;
  iteration: number;
  findings: ReviewFinding[];
  history: ReviewIteration[];
}

export interface TaskContract {
  version: 1;
  taskId: string;
  repository: string;
  baseCommit: string;
  objective: string;
  allowedPaths: string[];
  forbiddenPaths: string[];
  acceptanceCriteria: string[];
  baselineChecks: string[];
  requiredChecks: string[];
  acceptanceChecks: AcceptanceCheckConfig[];
  skills?: SkillConfig;
  instructions: string;
  harness: HarnessConfig;
  execution: ExecutionConfig;
  lineage: ContractLineage;
}

export interface CommandResult {
  command: string;
  args: string[];
  cwd: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
}

export interface CheckResult extends CommandResult {
  check: string;
}

export interface AcceptanceCheckResult extends CommandResult {
  id: string;
  script: string;
}

export interface BoundaryResult {
  changedFiles: string[];
  allowedFiles: string[];
  violations: Array<{
    path: string;
    reason: "not-allowed" | "explicitly-forbidden";
  }>;
}

export interface GitPolicyAudit {
  wrapperPath: string;
  logPath: string;
  wrapperSha256: string;
  blockedCommands: Array<{ subcommand: string; args: string[] }>;
  startingHead: string;
  finalHead: string;
  refChanges: Array<{ ref: string; before: string | null; after: string | null }>;
  verified: boolean;
  violations: string[];
}

export interface RunReport {
  version: 1;
  runId: string;
  taskId: string;
  status: "passed" | "failed" | "blocked";
  repository: string;
  baseCommit: string;
  branch: string;
  worktree: string;
  startedAt: string;
  completedAt: string;
  harness: CommandResult | null;
  baselineChecks: CheckResult[];
  checks: CheckResult[];
  acceptanceChecks: AcceptanceCheckResult[];
  skills: SkillAudit | null;
  gitPolicy: GitPolicyAudit | null;
  boundary: BoundaryResult;
  patchPath: string | null;
  reportPath: string;
  blockers: string[];
  failureReasons: string[];
  lineage: ContractLineage;
}

export type RunPhase =
  | "preparing"
  | "harness"
  | "checking"
  | "verification"
  | "complete";

export interface RunEvent {
  timestamp: string;
  phase: RunPhase;
  message: string;
}

export interface RunTaskOptions {
  harnessTransport?: HarnessTransport | undefined;
  onEvent?: ((event: RunEvent) => void) | undefined;
  onHarnessStdout?: ((chunk: string) => void) | undefined;
  onHarnessStderr?: ((chunk: string) => void) | undefined;
}
