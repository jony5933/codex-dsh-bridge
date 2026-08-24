import { randomUUID } from "node:crypto";
import type { WebHostClient } from "./client.js";
import {
  runWebHostSession,
  WebHostSessionError,
  type WebHostSessionRequest,
  type WebHostSessionResult,
} from "./session.js";

export type WebHostMode = "web-direct" | "web-guarded";

export interface WebHostTransportRequest {
  mode: WebHostMode;
  executionPath: string;
  prompt: string;
  timeoutMs: number;
  cancelTimeoutMs?: number;
  maxReconnects?: number;
  agentPreset?: string;
  sessionId?: string;
}

export interface WebHostTransportCapabilities {
  workspaceGrouping: true;
  liveEvents: true;
  processEnvironment: false;
  skillPatch: false;
  gitCommandWrapper: false;
  postRunGitRefAudit: "caller-required" | "not-requested";
  postRunChecks: "caller-required" | "not-requested";
  postRunBoundaryCheck: "caller-required" | "not-requested";
  postRunArtifacts: "caller-required" | "not-requested";
}

export interface WebHostTransportErrorEvidence {
  name: string;
  code: string | null;
  message: string;
}

export interface WebHostTransportEvidence {
  version: 1;
  kind: "web-host";
  mode: WebHostMode;
  status: "completed" | "failed" | "blocked";
  executionPath: string;
  sessionId: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  session: WebHostSessionResult | null;
  error: WebHostTransportErrorEvidence | null;
  capabilities: WebHostTransportCapabilities;
}

type RunSession = (
  client: WebHostClient,
  request: WebHostSessionRequest,
) => Promise<WebHostSessionResult>;

export interface WebHostTransportOptions {
  client: WebHostClient;
  createSessionId?: () => string;
  now?: () => Date;
  runSession?: RunSession;
}

function capabilities(mode: WebHostMode): WebHostTransportCapabilities {
  const postRun = mode === "web-guarded" ? "caller-required" : "not-requested";
  return {
    workspaceGrouping: true,
    liveEvents: true,
    processEnvironment: false,
    skillPatch: false,
    gitCommandWrapper: false,
    postRunGitRefAudit: postRun,
    postRunChecks: postRun,
    postRunBoundaryCheck: postRun,
    postRunArtifacts: postRun,
  };
}

function errorEvidence(error: unknown): WebHostTransportErrorEvidence {
  if (error instanceof WebHostSessionError) {
    return { name: error.name, code: error.code, message: error.message };
  }
  if (error instanceof Error) {
    return { name: error.name, code: null, message: error.message };
  }
  return { name: "Error", code: null, message: String(error) };
}

export class WebHostTransport {
  readonly kind = "web-host";
  private readonly client: WebHostClient;
  private readonly sessionIdFactory: () => string;
  private readonly clock: () => Date;
  private readonly runSession: RunSession;

  constructor(options: WebHostTransportOptions) {
    this.client = options.client;
    this.sessionIdFactory = options.createSessionId ?? randomUUID;
    this.clock = options.now ?? (() => new Date());
    this.runSession = options.runSession ?? runWebHostSession;
  }

  async execute(request: WebHostTransportRequest): Promise<WebHostTransportEvidence> {
    const startedAt = this.clock();
    const sessionId = request.sessionId ?? this.sessionIdFactory();
    const shared = {
      version: 1 as const,
      kind: "web-host" as const,
      mode: request.mode,
      executionPath: request.executionPath,
      sessionId,
      startedAt: startedAt.toISOString(),
      capabilities: capabilities(request.mode),
    };
    try {
      const session = await this.runSession(this.client, {
        sessionId,
        workspacePath: request.executionPath,
        prompt: request.prompt,
        timeoutMs: request.timeoutMs,
        ...(request.cancelTimeoutMs === undefined
          ? {}
          : { cancelTimeoutMs: request.cancelTimeoutMs }),
        ...(request.maxReconnects === undefined
          ? {}
          : { maxReconnects: request.maxReconnects }),
        ...(request.agentPreset === undefined ? {} : { agentPreset: request.agentPreset }),
      });
      const completedAt = this.clock();
      return {
        ...shared,
        status: session.outcome === "completed" ? "completed" : "failed",
        completedAt: completedAt.toISOString(),
        durationMs: Math.max(0, completedAt.getTime() - startedAt.getTime()),
        session,
        error: null,
      };
    } catch (error) {
      const completedAt = this.clock();
      const normalized = errorEvidence(error);
      return {
        ...shared,
        status: normalized.code === "interaction-required" ? "blocked" : "failed",
        completedAt: completedAt.toISOString(),
        durationMs: Math.max(0, completedAt.getTime() - startedAt.getTime()),
        session: null,
        error: normalized,
      };
    }
  }
}
