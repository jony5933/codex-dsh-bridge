import { randomUUID } from "node:crypto";
import { link, lstat, mkdir, readdir, readFile, realpath, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type { WebHostMode, WebHostTransportEvidence } from "./transport.js";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 1_000;

export interface WebHostRunIndexRecord {
  version: 1;
  kind: "web-host-run-index";
  projectPath: string;
  workspaceId: string | null;
  sessionId: string;
  mode: WebHostMode;
  status: "completed" | "failed" | "blocked";
  startedAt: string;
  completedAt: string;
  evidencePath: string;
  indexPath: string;
}

export interface WebHostRunQuery {
  artifactRoot: string;
  projectPath?: string;
  workspaceId?: string;
  sessionId?: string;
  status?: WebHostRunIndexRecord["status"];
  since?: string;
  until?: string;
  limit: number;
}

export interface WebHostRunQueryResult {
  version: 1;
  artifactRoot: string;
  count: number;
  runs: WebHostRunIndexRecord[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireSafeIdentifier(value: string, label: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(value)) {
    throw new Error(`Unsafe ${label}: ${value}`);
  }
  return value;
}

function parseIsoInstant(value: string, option: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T/.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${option} must be a valid ISO 8601 timestamp.`);
  }
  return new Date(value).toISOString();
}

function requireOptionValue(arguments_: string[], index: number, option: string): string {
  const value = arguments_[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`Missing value for ${option}.`);
  }
  return value;
}

export function parseWebRunQueryArguments(
  arguments_: string[],
  homeDirectory = homedir(),
): WebHostRunQuery {
  const query: WebHostRunQuery = {
    artifactRoot: resolve(homeDirectory, ".dsh-bridge", "runs"),
    limit: DEFAULT_LIMIT,
  };
  const seen = new Set<string>();
  for (let index = 0; index < arguments_.length; index += 2) {
    const option = arguments_[index];
    if (
      option !== "--artifact-root" &&
      option !== "--project" &&
      option !== "--workspace" &&
      option !== "--session" &&
      option !== "--status" &&
      option !== "--since" &&
      option !== "--until" &&
      option !== "--limit"
    ) {
      throw new Error(`Unknown web-runs option: ${String(option)}.`);
    }
    if (seen.has(option)) throw new Error(`Duplicate web-runs option: ${option}.`);
    seen.add(option);
    const value = requireOptionValue(arguments_, index, option);
    if (option === "--artifact-root") query.artifactRoot = resolve(value);
    if (option === "--project") query.projectPath = resolve(value);
    if (option === "--workspace") query.workspaceId = requireSafeIdentifier(value, "Workspace id");
    if (option === "--session") query.sessionId = requireSafeIdentifier(value, "session id");
    if (option === "--status") {
      if (value !== "completed" && value !== "failed" && value !== "blocked") {
        throw new Error("--status must be completed, failed, or blocked.");
      }
      query.status = value;
    }
    if (option === "--since") query.since = parseIsoInstant(value, option);
    if (option === "--until") query.until = parseIsoInstant(value, option);
    if (option === "--limit") {
      const limit = Number(value);
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
        throw new Error(`--limit must be an integer between 1 and ${MAX_LIMIT}.`);
      }
      query.limit = limit;
    }
  }
  if (query.since !== undefined && query.until !== undefined && query.since > query.until) {
    throw new Error("--since must not be later than --until.");
  }
  return query;
}

function parseIndexRecord(value: unknown, path: string): WebHostRunIndexRecord {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    value.kind !== "web-host-run-index" ||
    typeof value.projectPath !== "string" ||
    !isAbsolute(value.projectPath) ||
    (value.workspaceId !== null && typeof value.workspaceId !== "string") ||
    typeof value.sessionId !== "string" ||
    (value.mode !== "web-direct" && value.mode !== "web-guarded") ||
    (value.status !== "completed" && value.status !== "failed" && value.status !== "blocked") ||
    typeof value.startedAt !== "string" ||
    !Number.isFinite(Date.parse(value.startedAt)) ||
    typeof value.completedAt !== "string" ||
    !Number.isFinite(Date.parse(value.completedAt)) ||
    typeof value.evidencePath !== "string" ||
    !isAbsolute(value.evidencePath) ||
    typeof value.indexPath !== "string" ||
    value.indexPath !== path
  ) {
    throw new Error(`Invalid Web Host run index record: ${path}`);
  }
  requireSafeIdentifier(value.sessionId, "session id");
  if (typeof value.workspaceId === "string") {
    requireSafeIdentifier(value.workspaceId, "Workspace id");
  }
  return value as unknown as WebHostRunIndexRecord;
}

async function publishJson(path: string, value: unknown): Promise<void> {
  const directory = dirname(path);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporaryPath = join(directory, `.index-${randomUUID()}.tmp`);
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  try {
    await link(temporaryPath, path);
  } finally {
    await unlink(temporaryPath);
  }
}

export async function persistWebHostRunIndex(
  evidence: WebHostTransportEvidence,
  evidencePath: string,
  artifactRoot: string,
): Promise<WebHostRunIndexRecord> {
  requireSafeIdentifier(evidence.sessionId, "Web Host sessionId for index path");
  const projectPath = await realpath(evidence.executionPath);
  const day = evidence.startedAt.slice(0, 10);
  const indexPath = join(artifactRoot, "index", day, `${evidence.sessionId}.json`);
  const record: WebHostRunIndexRecord = {
    version: 1,
    kind: "web-host-run-index",
    projectPath,
    workspaceId: evidence.session?.workspaceId ?? null,
    sessionId: evidence.sessionId,
    mode: evidence.mode,
    status: evidence.status,
    startedAt: evidence.startedAt,
    completedAt: evidence.completedAt,
    evidencePath,
    indexPath,
  };
  await publishJson(indexPath, record);
  return record;
}

async function listIndexPaths(artifactRoot: string): Promise<string[]> {
  const indexRoot = join(artifactRoot, "index");
  let dayEntries;
  try {
    dayEntries = await readdir(indexRoot, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const paths: string[] = [];
  for (const dayEntry of dayEntries) {
    if (!dayEntry.isDirectory() || !/^\d{4}-\d{2}-\d{2}$/.test(dayEntry.name)) continue;
    const dayPath = join(indexRoot, dayEntry.name);
    for (const entry of await readdir(dayPath, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith(".json")) paths.push(join(dayPath, entry.name));
    }
  }
  return paths;
}

export async function queryWebHostRuns(query: WebHostRunQuery): Promise<WebHostRunQueryResult> {
  let artifactRoot: string;
  try {
    artifactRoot = await realpath(query.artifactRoot);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { version: 1, artifactRoot: resolve(query.artifactRoot), count: 0, runs: [] };
    }
    throw error;
  }
  const projectPath =
    query.projectPath === undefined ? undefined : await realpath(query.projectPath);
  const records: WebHostRunIndexRecord[] = [];
  for (const path of await listIndexPaths(artifactRoot)) {
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error(`Web Host run index entry is not a regular file: ${path}`);
    }
    const record = parseIndexRecord(JSON.parse(await readFile(path, "utf8")), path);
    if (projectPath !== undefined && record.projectPath !== projectPath) continue;
    if (query.workspaceId !== undefined && record.workspaceId !== query.workspaceId) continue;
    if (query.sessionId !== undefined && record.sessionId !== query.sessionId) continue;
    if (query.status !== undefined && record.status !== query.status) continue;
    if (query.since !== undefined && record.startedAt < query.since) continue;
    if (query.until !== undefined && record.startedAt > query.until) continue;
    records.push(record);
  }
  records.sort((left, right) => {
    const byTime = right.startedAt.localeCompare(left.startedAt);
    return byTime === 0 ? right.sessionId.localeCompare(left.sessionId) : byTime;
  });
  const runs = records.slice(0, query.limit);
  return { version: 1, artifactRoot, count: runs.length, runs };
}
