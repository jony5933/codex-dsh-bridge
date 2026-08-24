import { randomUUID } from "node:crypto";
import { link, lstat, mkdir, realpath, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { persistWebHostRunIndex } from "./index.js";
import type { WebHostTransportEvidence } from "./transport.js";

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1_000;
const MAX_TIMEOUT_MS = 24 * 60 * 60 * 1_000;

export interface WebRunArguments {
  projectPath: string;
  promptPath: string;
  endpoint: string;
  timeoutMs: number;
  artifactRoot: string;
}

export interface WebProbeArguments {
  projectPath: string;
  endpoint: string;
  artifactRoot: string;
}

export interface PersistedWebHostEvidence extends WebHostTransportEvidence {
  evidencePath: string;
  indexPath: string;
  compatibilityProbePath: string | null;
}

function requireOptionValue(arguments_: string[], index: number, option: string): string {
  const value = arguments_[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`Missing value for ${option}.`);
  }
  return value;
}

function parseTimeout(value: string): number {
  const timeoutMs = Number(value);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMEOUT_MS) {
    throw new Error(`--timeout-ms must be an integer between 1 and ${MAX_TIMEOUT_MS}.`);
  }
  return timeoutMs;
}

export function parseWebRunArguments(
  arguments_: string[],
  homeDirectory = homedir(),
): WebRunArguments {
  const [projectPath, promptPath, ...options] = arguments_;
  if (!projectPath || !promptPath || projectPath.startsWith("--") || promptPath.startsWith("--")) {
    throw new Error("web-run requires <project-path> and <prompt.md>.");
  }
  let endpoint = "http://127.0.0.1:3080";
  let timeoutMs = DEFAULT_TIMEOUT_MS;
  let artifactRoot = join(homeDirectory, ".dsh-bridge", "runs");
  const seen = new Set<string>();
  for (let index = 0; index < options.length; index += 2) {
    const option = options[index];
    if (option !== "--endpoint" && option !== "--timeout-ms" && option !== "--artifact-root") {
      throw new Error(`Unknown web-run option: ${String(option)}.`);
    }
    if (seen.has(option)) throw new Error(`Duplicate web-run option: ${option}.`);
    seen.add(option);
    const value = requireOptionValue(options, index, option);
    if (option === "--endpoint") endpoint = value;
    if (option === "--timeout-ms") timeoutMs = parseTimeout(value);
    if (option === "--artifact-root") artifactRoot = resolve(value);
  }
  return {
    projectPath,
    promptPath,
    endpoint,
    timeoutMs,
    artifactRoot: resolve(artifactRoot),
  };
}

export function parseWebProbeArguments(
  arguments_: string[],
  homeDirectory = homedir(),
): WebProbeArguments {
  const [projectPath, ...options] = arguments_;
  if (!projectPath || projectPath.startsWith("--")) {
    throw new Error("web-probe requires <project-path>.");
  }
  let endpoint = "http://127.0.0.1:3080";
  let artifactRoot = join(homeDirectory, ".dsh-bridge", "runs");
  const seen = new Set<string>();
  for (let index = 0; index < options.length; index += 2) {
    const option = options[index];
    if (option !== "--endpoint" && option !== "--artifact-root") {
      throw new Error(`Unknown web-probe option: ${String(option)}.`);
    }
    if (seen.has(option)) throw new Error(`Duplicate web-probe option: ${option}.`);
    seen.add(option);
    const value = requireOptionValue(options, index, option);
    if (option === "--endpoint") endpoint = value;
    if (option === "--artifact-root") artifactRoot = resolve(value);
  }
  return { projectPath, endpoint, artifactRoot: resolve(artifactRoot) };
}

function isInside(parent: string, candidate: string): boolean {
  const pathFromParent = relative(parent, candidate);
  return pathFromParent === "" || (!pathFromParent.startsWith("..") && !isAbsolute(pathFromParent));
}

async function canonicalizeProspectivePath(path: string): Promise<string> {
  let ancestor = resolve(path);
  const missing: string[] = [];
  while (true) {
    try {
      await lstat(ancestor);
      return resolve(await realpath(ancestor), ...missing.reverse());
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const parent = dirname(ancestor);
      if (parent === ancestor) throw error;
      missing.push(basename(ancestor));
      ancestor = parent;
    }
  }
}

export async function persistWebHostEvidence(
  evidence: WebHostTransportEvidence,
  artifactRoot: string,
  compatibilityProbePath: string | null = null,
): Promise<PersistedWebHostEvidence> {
  if (!/^[A-Za-z0-9._-]+$/.test(evidence.sessionId)) {
    throw new Error(`Unsafe Web Host sessionId for artifact path: ${evidence.sessionId}`);
  }
  const canonicalArtifactRoot = await prepareWebHostArtifactRoot(
    evidence.executionPath,
    artifactRoot,
  );
  const day = evidence.startedAt.slice(0, 10);
  const runDirectory = join(canonicalArtifactRoot, day, evidence.sessionId);
  const evidencePath = join(runDirectory, "evidence.json");
  const indexPath = join(canonicalArtifactRoot, "index", day, `${evidence.sessionId}.json`);
  await mkdir(runDirectory, { recursive: true, mode: 0o700 });
  const persisted: PersistedWebHostEvidence = {
    ...evidence,
    evidencePath,
    indexPath,
    compatibilityProbePath,
  };
  const temporaryPath = join(runDirectory, `.evidence-${randomUUID()}.tmp`);
  await writeFile(temporaryPath, `${JSON.stringify(persisted, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  try {
    await link(temporaryPath, evidencePath);
  } finally {
    await unlink(temporaryPath);
  }
  try {
    await persistWebHostRunIndex(evidence, evidencePath, canonicalArtifactRoot);
  } catch (error) {
    try {
      await unlink(evidencePath);
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        `Web Host evidence index failed and evidence cleanup was unsuccessful: ${evidencePath}`,
      );
    }
    throw error;
  }
  return persisted;
}

export async function prepareWebHostArtifactRoot(
  executionPath: string,
  artifactRoot: string,
): Promise<string> {
  const projectPath = await realpath(executionPath);
  const prospectiveRoot = await canonicalizeProspectivePath(artifactRoot);
  if (isInside(projectPath, prospectiveRoot)) {
    throw new Error(`Web Host artifact root must be outside the target project: ${artifactRoot}`);
  }
  await mkdir(prospectiveRoot, { recursive: true, mode: 0o700 });
  const canonicalArtifactRoot = await realpath(prospectiveRoot);
  if (isInside(projectPath, canonicalArtifactRoot)) {
    throw new Error(`Web Host artifact root resolves inside the target project: ${artifactRoot}`);
  }
  return canonicalArtifactRoot;
}
