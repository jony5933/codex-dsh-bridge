import { randomUUID } from "node:crypto";
import { link, mkdir, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createCheckEnvironment, runCommand } from "../../lib/command.js";
import type {
  WebHostClient,
  WebHostDownlink,
  WebHostRpcMethod,
  WebHostStream,
} from "./client.js";

export const SUPPORTED_DSH_VERSIONS = [
  "0.1.0-rc.8",
  "0.1.1-rc.1",
  "0.1.1-rc.2",
] as const;
export const KNOWN_UNVERIFIED_DSH_VERSIONS: readonly string[] = [];
const SUPPORTED_HOST_PROTOCOL_VERSIONS = new Set(["0.0.1"]);

interface CompatibilityClient {
  readonly endpoint: string;
  call<T>(method: WebHostRpcMethod, payload: Record<string, unknown>, signal?: AbortSignal): Promise<T>;
  openDownlink(
    stream: WebHostStream,
    signal: AbortSignal,
    onFrame: () => void,
  ): WebHostDownlink;
}

interface DshVersionObservation {
  command: string;
  version: string | null;
  exitCode: number | null;
  timedOut: boolean;
  error: string | null;
}

export interface WebHostCompatibilityCheck {
  id:
    | "dsh-cli-version"
    | "host-describe"
    | "workspace-list"
    | "session-list"
    | "mux-downlink"
    | "host-downlink";
  status: "passed" | "failed" | "not-run";
  detail: string;
}

export interface WebHostCompatibilityEvidence {
  version: 1;
  kind: "web-host-compatibility";
  status: "compatible" | "incompatible";
  observedAt: string;
  endpoint: string;
  readOnly: true;
  dsh: DshVersionObservation & {
    source: "local-cli";
    sameProcessAsHost: "unverified";
    supportedVersions: readonly string[];
    knownUnverifiedVersions: readonly string[];
  };
  host: {
    protocolVersion: string | null;
    provider: string | null;
    model: string | null;
  };
  checks: WebHostCompatibilityCheck[];
  failureReasons: string[];
  mutations: {
    workspaceCreated: false;
    sessionCreated: false;
    promptSent: false;
  };
}

export interface PersistedWebHostCompatibilityEvidence extends WebHostCompatibilityEvidence {
  probePath: string;
  plannedSessionId: string;
}

export interface WebHostCompatibilityOptions {
  cwd: string;
  dshCommand?: string;
  downlinkTimeoutMs?: number;
  now?: () => Date;
  readDshVersion?: () => Promise<DshVersionObservation>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function readDshVersion(command: string, cwd: string): Promise<DshVersionObservation> {
  try {
    const result = await runCommand(command, ["--version"], {
      cwd,
      timeoutMs: 10_000,
      env: createCheckEnvironment(),
    });
    const version = result.stdout.trim();
    const validVersion = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version);
    return {
      command,
      version: result.exitCode === 0 && !result.timedOut && validVersion ? version : null,
      exitCode: result.exitCode,
      timedOut: result.timedOut,
      error:
        result.exitCode === 0 && !result.timedOut && validVersion
          ? null
          : `Unable to parse DSH version from ${command} --version.`,
    };
  } catch (error) {
    return {
      command,
      version: null,
      exitCode: null,
      timedOut: false,
      error: errorMessage(error),
    };
  }
}

function validateHostDescription(value: unknown): {
  protocolVersion: string;
  provider: string | null;
  model: string | null;
} {
  if (
    !isRecord(value) ||
    typeof value.version !== "string" ||
    typeof value.cwd !== "string" ||
    typeof value.home !== "string" ||
    typeof value.attachedSessions !== "number" ||
    !Number.isSafeInteger(value.attachedSessions) ||
    typeof value.canOpenPath !== "boolean" ||
    (value.provider !== undefined && typeof value.provider !== "string") ||
    (value.model !== undefined && typeof value.model !== "string")
  ) {
    throw new Error("host.describe does not match the supported adapter schema.");
  }
  if (!SUPPORTED_HOST_PROTOCOL_VERSIONS.has(value.version)) {
    throw new Error(`Unsupported Web Host protocol marker: ${value.version}.`);
  }
  return {
    protocolVersion: value.version,
    provider: typeof value.provider === "string" ? value.provider : null,
    model: typeof value.model === "string" ? value.model : null,
  };
}

function validateWorkspaceList(value: unknown): number {
  if (
    !isRecord(value) ||
    !Array.isArray(value.items) ||
    !Array.isArray(value.archivedSessionIds) ||
    !value.archivedSessionIds.every((sessionId) => typeof sessionId === "string")
  ) {
    throw new Error("workspace.list does not match the supported adapter schema.");
  }
  for (const workspace of value.items) {
    if (
      !isRecord(workspace) ||
      typeof workspace.workspaceId !== "string" ||
      typeof workspace.path !== "string" ||
      typeof workspace.title !== "string" ||
      !Array.isArray(workspace.sessionIds) ||
      !workspace.sessionIds.every((sessionId) => typeof sessionId === "string") ||
      typeof workspace.createdAt !== "string" ||
      typeof workspace.updatedAt !== "string"
    ) {
      throw new Error("workspace.list contains an incompatible Workspace record.");
    }
  }
  return value.items.length;
}

function validateSessionList(value: unknown): number {
  if (!isRecord(value) || !Array.isArray(value.items)) {
    throw new Error("session.list does not match the supported adapter schema.");
  }
  for (const session of value.items) {
    if (
      !isRecord(session) ||
      typeof session.sessionId !== "string" ||
      typeof session.running !== "boolean"
    ) {
      throw new Error("session.list contains an incompatible session record.");
    }
  }
  return value.items.length;
}

function initialChecks(): WebHostCompatibilityCheck[] {
  return [
    { id: "dsh-cli-version", status: "not-run", detail: "Not run." },
    { id: "host-describe", status: "not-run", detail: "Not run." },
    { id: "workspace-list", status: "not-run", detail: "Not run." },
    { id: "session-list", status: "not-run", detail: "Not run." },
    { id: "mux-downlink", status: "not-run", detail: "Not run." },
    { id: "host-downlink", status: "not-run", detail: "Not run." },
  ];
}

function updateCheck(
  checks: WebHostCompatibilityCheck[],
  id: WebHostCompatibilityCheck["id"],
  status: WebHostCompatibilityCheck["status"],
  detail: string,
): void {
  const check = checks.find((candidate) => candidate.id === id);
  if (check === undefined) throw new Error(`Unknown compatibility check: ${id}`);
  check.status = status;
  check.detail = detail;
}

async function openRequiredDownlinks(
  client: CompatibilityClient,
  checks: WebHostCompatibilityCheck[],
  timeoutMs: number,
): Promise<void> {
  const controller = new AbortController();
  let timeout: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(new Error(`Web Host compatibility downlinks timed out after ${timeoutMs} ms.`));
    }, timeoutMs);
  });
  let mux: WebHostDownlink | undefined;
  let host: WebHostDownlink | undefined;
  try {
    mux = client.openDownlink("mux", controller.signal, () => undefined);
    host = client.openDownlink("host", controller.signal, () => undefined);
    const settled = await Promise.allSettled([
      Promise.race([mux.opened, deadline]),
      Promise.race([host.opened, deadline]),
    ]);
    const muxResult = settled[0]!;
    const hostResult = settled[1]!;
    if (muxResult.status === "rejected") {
      updateCheck(checks, "mux-downlink", "failed", errorMessage(muxResult.reason));
    } else {
      updateCheck(checks, "mux-downlink", "passed", "Mux WebSocket opened.");
    }
    if (hostResult.status === "rejected") {
      updateCheck(checks, "host-downlink", "failed", errorMessage(hostResult.reason));
    } else {
      updateCheck(checks, "host-downlink", "passed", "Host WebSocket opened.");
    }
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
    controller.abort();
    await Promise.allSettled([
      ...(mux === undefined ? [] : [mux.closed]),
      ...(host === undefined ? [] : [host.closed]),
    ]);
  }
}

export async function probeWebHostCompatibility(
  client: CompatibilityClient | WebHostClient,
  options: WebHostCompatibilityOptions,
): Promise<WebHostCompatibilityEvidence> {
  const observedAt = (options.now ?? (() => new Date()))().toISOString();
  const checks = initialChecks();
  const dshCommand = options.dshCommand ?? "dsh";
  const downlinkTimeoutMs = options.downlinkTimeoutMs ?? 10_000;
  if (!Number.isSafeInteger(downlinkTimeoutMs) || downlinkTimeoutMs < 1) {
    throw new Error("Compatibility downlink timeout must be a positive integer.");
  }
  const dsh = await (options.readDshVersion ?? (() => readDshVersion(dshCommand, options.cwd)))();
  const failureReasons: string[] = [];
  const evidence: WebHostCompatibilityEvidence = {
    version: 1,
    kind: "web-host-compatibility",
    status: "incompatible",
    observedAt,
    endpoint: client.endpoint,
    readOnly: true,
    dsh: {
      ...dsh,
      source: "local-cli",
      sameProcessAsHost: "unverified",
      supportedVersions: [...SUPPORTED_DSH_VERSIONS],
      knownUnverifiedVersions: [...KNOWN_UNVERIFIED_DSH_VERSIONS],
    },
    host: { protocolVersion: null, provider: null, model: null },
    checks,
    failureReasons,
    mutations: { workspaceCreated: false, sessionCreated: false, promptSent: false },
  };

  if (dsh.version === null || !(SUPPORTED_DSH_VERSIONS as readonly string[]).includes(dsh.version)) {
    const detail =
      dsh.version === null
        ? dsh.error ?? "DSH version is unavailable."
        : `DSH ${dsh.version} is not in the verified compatibility set.`;
    updateCheck(checks, "dsh-cli-version", "failed", detail);
    failureReasons.push(detail);
  } else {
    updateCheck(checks, "dsh-cli-version", "passed", `Verified local DSH ${dsh.version}.`);
  }

  try {
    const host = validateHostDescription(await client.call<unknown>("host.describe", {}));
    evidence.host = host;
    updateCheck(checks, "host-describe", "passed", `Protocol marker ${host.protocolVersion}.`);
  } catch (error) {
    const detail = errorMessage(error);
    updateCheck(checks, "host-describe", "failed", detail);
    failureReasons.push(detail);
    return evidence;
  }

  try {
    const count = validateWorkspaceList(await client.call<unknown>("workspace.list", {}));
    updateCheck(checks, "workspace-list", "passed", `Validated ${count} Workspace records.`);
  } catch (error) {
    const detail = errorMessage(error);
    updateCheck(checks, "workspace-list", "failed", detail);
    failureReasons.push(detail);
    return evidence;
  }

  try {
    const count = validateSessionList(await client.call<unknown>("session.list", {}));
    updateCheck(checks, "session-list", "passed", `Validated ${count} session records.`);
  } catch (error) {
    const detail = errorMessage(error);
    updateCheck(checks, "session-list", "failed", detail);
    failureReasons.push(detail);
    return evidence;
  }

  try {
    await openRequiredDownlinks(client, checks, downlinkTimeoutMs);
  } catch (error) {
    failureReasons.push(errorMessage(error));
    return evidence;
  }
  for (const check of checks) {
    if (check.status === "failed" && !failureReasons.includes(check.detail)) {
      failureReasons.push(check.detail);
    }
  }
  if (failureReasons.length === 0 && checks.every((check) => check.status === "passed")) {
    evidence.status = "compatible";
  }
  return evidence;
}

export async function persistWebHostCompatibilityEvidence(
  evidence: WebHostCompatibilityEvidence,
  artifactRoot: string,
  plannedSessionId: string,
): Promise<PersistedWebHostCompatibilityEvidence> {
  if (!/^[A-Za-z0-9._-]+$/.test(plannedSessionId)) {
    throw new Error(`Unsafe planned session id for compatibility evidence: ${plannedSessionId}`);
  }
  const day = evidence.observedAt.slice(0, 10);
  const probePath = join(artifactRoot, day, plannedSessionId, "compatibility.json");
  const persisted: PersistedWebHostCompatibilityEvidence = {
    ...evidence,
    probePath,
    plannedSessionId,
  };
  const directory = dirname(probePath);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporaryPath = join(directory, `.compatibility-${randomUUID()}.tmp`);
  await writeFile(temporaryPath, `${JSON.stringify(persisted, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  try {
    await link(temporaryPath, probePath);
  } finally {
    await unlink(temporaryPath);
  }
  return persisted;
}
