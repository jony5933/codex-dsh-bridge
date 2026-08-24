import { isAbsolute } from "node:path";
import { realpath } from "node:fs/promises";
import type { WebHostClient, WebHostRpcMethod } from "./client.js";

interface WorkspaceClient {
  call<T>(
    method: WebHostRpcMethod,
    payload: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<T>;
}

export interface WebHostWorkspace {
  workspaceId: string;
  path: string;
  title: string;
  sessionIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceResolution {
  workspace: WebHostWorkspace;
  canonicalPath: string;
  created: boolean;
}

export class WebHostWorkspaceError extends Error {
  readonly code: "invalid-path" | "invalid-response" | "ambiguous-workspace" | "wrong-workspace";

  constructor(code: WebHostWorkspaceError["code"], message: string) {
    super(message);
    this.name = "WebHostWorkspaceError";
    this.code = code;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseWorkspace(value: unknown, label: string): WebHostWorkspace {
  if (
    !isRecord(value) ||
    typeof value.workspaceId !== "string" ||
    value.workspaceId.length === 0 ||
    typeof value.path !== "string" ||
    typeof value.title !== "string" ||
    !Array.isArray(value.sessionIds) ||
    !value.sessionIds.every((sessionId) => typeof sessionId === "string" && sessionId.length > 0) ||
    typeof value.createdAt !== "string" ||
    typeof value.updatedAt !== "string"
  ) {
    throw new WebHostWorkspaceError("invalid-response", `Invalid ${label} workspace.`);
  }
  return {
    workspaceId: value.workspaceId,
    path: value.path,
    title: value.title,
    sessionIds: [...value.sessionIds],
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

async function listWorkspaces(
  client: WorkspaceClient | WebHostClient,
  signal?: AbortSignal,
): Promise<WebHostWorkspace[]> {
  const value = await client.call<unknown>("workspace.list", {}, signal);
  if (
    !isRecord(value) ||
    !Array.isArray(value.items) ||
    !Array.isArray(value.archivedSessionIds) ||
    !value.archivedSessionIds.every(
      (sessionId) => typeof sessionId === "string" && sessionId.length > 0,
    )
  ) {
    throw new WebHostWorkspaceError("invalid-response", "Invalid workspace.list response.");
  }
  return value.items.map((item, index) =>
    parseWorkspace(item, `workspace.list.items[${index}]`),
  );
}

async function canonicalizeWorkspacePath(path: string): Promise<string> {
  if (!isAbsolute(path) || path.length === 0) {
    throw new WebHostWorkspaceError(
      "invalid-path",
      "Workspace path must be a non-empty absolute path.",
    );
  }
  try {
    return await realpath(path);
  } catch (error) {
    throw new WebHostWorkspaceError(
      "invalid-path",
      `Workspace path cannot be resolved: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function resolveWebHostWorkspace(
  client: WorkspaceClient | WebHostClient,
  path: string,
  signal?: AbortSignal,
): Promise<WorkspaceResolution> {
  const canonicalPath = await canonicalizeWorkspacePath(path);
  const matches = (await listWorkspaces(client, signal)).filter(
    (workspace) => workspace.path === canonicalPath,
  );
  if (matches.length > 1) {
    throw new WebHostWorkspaceError(
      "ambiguous-workspace",
      `Multiple Workspaces use canonical path ${canonicalPath}.`,
    );
  }
  if (matches[0] !== undefined) {
    return { workspace: matches[0], canonicalPath, created: false };
  }

  const value = await client.call<unknown>(
    "workspace.create",
    { path: canonicalPath },
    signal,
  );
  if (!isRecord(value) || typeof value.created !== "boolean") {
    throw new WebHostWorkspaceError("invalid-response", "Invalid workspace.create response.");
  }
  const workspace = parseWorkspace(value.workspace, "workspace.create");
  if (workspace.path !== canonicalPath) {
    throw new WebHostWorkspaceError(
      "wrong-workspace",
      `workspace.create returned path ${workspace.path}; expected ${canonicalPath}.`,
    );
  }
  return { workspace, canonicalPath, created: value.created };
}

export async function verifyWebHostSessionWorkspace(
  client: WorkspaceClient | WebHostClient,
  workspaceId: string,
  canonicalPath: string,
  sessionId: string,
  signal?: AbortSignal,
): Promise<WebHostWorkspace> {
  const matches = (await listWorkspaces(client, signal)).filter(
    (workspace) => workspace.workspaceId === workspaceId,
  );
  if (matches.length !== 1) {
    throw new WebHostWorkspaceError(
      "wrong-workspace",
      `Expected exactly one Workspace ${workspaceId}; received ${matches.length}.`,
    );
  }
  const workspace = matches[0]!;
  if (workspace.path !== canonicalPath || !workspace.sessionIds.includes(sessionId)) {
    throw new WebHostWorkspaceError(
      "wrong-workspace",
      `Session ${sessionId} is not attached to Workspace ${workspaceId} at ${canonicalPath}.`,
    );
  }
  return workspace;
}
