import { randomUUID } from "node:crypto";

const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "[::1]", "localhost"]);
const MUX_FRAME_TYPES = new Set([
  "session/event",
  "session/subscribed",
  "approval/requested",
  "approval/resolved",
  "question/requested",
  "question/resolved",
  "session/queue",
  "session/jobs",
  "session/projection",
  "stream/error",
]);
const HOST_FRAME_TYPES = new Set([
  "host/session-added",
  "host/session-removed",
  "host/session-status",
  "host/agent-error",
  "host/workspace-changed",
  "host/workspace-removed",
  "host/workspace-order-changed",
  "host/archived-sessions-changed",
  "host/remote-event",
  "stream/error",
]);
const ALLOWED_RPC_METHODS = new Set<WebHostRpcMethod>([
  "host.describe",
  "session.list",
  "session.create",
  "session.history",
  "session.prompt",
  "session.cancel",
  "workspace.list",
  "workspace.create",
]);

export type WebHostStream = "mux" | "host";
export type WebHostRpcMethod =
  | "host.describe"
  | "session.list"
  | "session.create"
  | "session.history"
  | "session.prompt"
  | "session.cancel"
  | "workspace.list"
  | "workspace.create";

export interface WebHostRpcErrorValue {
  code: string;
  message: string;
  details: unknown;
}

export interface WebHostServerRequest {
  type: "server-request";
  rpcId: string;
  method: string;
  payload: Record<string, unknown>;
}

interface WebSocketEventMap {
  open: Event;
  message: MessageEvent;
  close: CloseEvent;
  error: Event;
}

export interface WebSocketLike {
  close(): void;
  addEventListener<K extends keyof WebSocketEventMap>(
    type: K,
    listener: (event: WebSocketEventMap[K]) => void,
    options?: AddEventListenerOptions,
  ): void;
  removeEventListener<K extends keyof WebSocketEventMap>(
    type: K,
    listener: (event: WebSocketEventMap[K]) => void,
  ): void;
}

export interface WebHostDownlink {
  readonly url: string;
  readonly opened: Promise<void>;
  readonly closed: Promise<void>;
  close(): void;
}

export interface WebHostClientOptions {
  endpoint?: string;
  requestTimeoutMs?: number;
  fetch?: typeof globalThis.fetch;
  createWebSocket?: (url: string) => WebSocketLike;
  createRpcId?: () => string;
}

export class WebHostProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebHostProtocolError";
  }
}

export class WebHostRpcError extends Error {
  readonly code: string;
  readonly details: unknown;

  constructor(error: WebHostRpcErrorValue) {
    super(`${error.code}: ${error.message}`);
    this.name = "WebHostRpcError";
    this.code = error.code;
    this.details = error.details;
  }
}

function parseEndpoint(value: string): URL {
  const endpoint = new URL(value);
  if (endpoint.protocol !== "http:" && endpoint.protocol !== "https:") {
    throw new WebHostProtocolError("Web Host endpoint must use http or https.");
  }
  if (!LOOPBACK_HOSTNAMES.has(endpoint.hostname)) {
    throw new WebHostProtocolError(
      `Web Host endpoint must be loopback; received ${endpoint.hostname}.`,
    );
  }
  if (endpoint.username || endpoint.password) {
    throw new WebHostProtocolError("Web Host endpoint must not contain credentials.");
  }
  if (endpoint.search || endpoint.hash || (endpoint.pathname !== "" && endpoint.pathname !== "/")) {
    throw new WebHostProtocolError("Web Host endpoint must be an origin without path, query, or hash.");
  }
  return new URL(endpoint.origin);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseServerResponse(value: unknown, rpcId: string, method: string): unknown {
  if (!isRecord(value) || value.type !== "server-response") {
    throw new WebHostProtocolError(`Invalid server-response envelope for ${method}.`);
  }
  if (value.rpcId !== rpcId) {
    throw new WebHostProtocolError(
      `rpcId mismatch for ${method}: sent ${rpcId}, got ${String(value.rpcId)}.`,
    );
  }
  const result = value.result;
  if (!isRecord(result) || typeof result.ok !== "boolean") {
    throw new WebHostProtocolError(`Invalid RPC result for ${method}.`);
  }
  if (result.ok) {
    if (!("value" in result)) {
      throw new WebHostProtocolError(`Successful RPC result has no value for ${method}.`);
    }
    return result.value;
  }
  const error = result.error;
  if (
    !isRecord(error) ||
    typeof error.code !== "string" ||
    typeof error.message !== "string" ||
    !("details" in error)
  ) {
    throw new WebHostProtocolError(`Invalid RPC error for ${method}.`);
  }
  throw new WebHostRpcError({
    code: error.code,
    message: error.message,
    details: error.details,
  });
}

function parseServerRequest(value: unknown, stream: WebHostStream): WebHostServerRequest {
  if (
    !isRecord(value) ||
    value.type !== "server-request" ||
    typeof value.rpcId !== "string" ||
    typeof value.method !== "string" ||
    !isRecord(value.payload)
  ) {
    throw new WebHostProtocolError(`Invalid server-request envelope on ${stream} downlink.`);
  }
  const frameType = value.payload.type;
  const allowedTypes = stream === "mux" ? MUX_FRAME_TYPES : HOST_FRAME_TYPES;
  if (
    typeof frameType !== "string" ||
    value.method !== frameType ||
    !allowedTypes.has(frameType)
  ) {
    throw new WebHostProtocolError(
      `Invalid ${stream} frame method/type pair: ${value.method} / ${String(frameType)}.`,
    );
  }
  return {
    type: "server-request",
    rpcId: value.rpcId,
    method: value.method,
    payload: value.payload,
  };
}

export class WebHostClient {
  readonly endpoint: string;
  private readonly requestTimeoutMs: number;
  private readonly fetchImplementation: typeof globalThis.fetch;
  private readonly webSocketFactory: (url: string) => WebSocketLike;
  private readonly rpcIdFactory: () => string;

  constructor(options: WebHostClientOptions = {}) {
    const endpoint = parseEndpoint(options.endpoint ?? "http://127.0.0.1:3080");
    if (!Number.isSafeInteger(options.requestTimeoutMs ?? 30_000) || (options.requestTimeoutMs ?? 30_000) < 1) {
      throw new WebHostProtocolError("requestTimeoutMs must be a positive integer.");
    }
    this.endpoint = endpoint.origin;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
    this.fetchImplementation = options.fetch ?? globalThis.fetch;
    this.webSocketFactory =
      options.createWebSocket ?? ((url) => new WebSocket(url) as unknown as WebSocketLike);
    this.rpcIdFactory = options.createRpcId ?? randomUUID;
  }

  async call<T>(
    method: WebHostRpcMethod,
    payload: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<T> {
    if (!ALLOWED_RPC_METHODS.has(method)) {
      throw new WebHostProtocolError(
        `Web Host RPC method is not allowed by the M7 adapter: ${method}.`,
      );
    }
    const rpcId = this.rpcIdFactory();
    if (rpcId.length === 0) throw new WebHostProtocolError("RPC id must not be empty.");
    const timeoutSignal = AbortSignal.timeout(this.requestTimeoutMs);
    const requestSignal =
      signal === undefined ? timeoutSignal : AbortSignal.any([timeoutSignal, signal]);
    const response = await this.fetchImplementation(
      new URL(`/api/${method}`, this.endpoint),
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "client-request",
          rpcId,
          method,
          payload,
        }),
        signal: requestSignal,
      },
    );
    if (!response.ok) {
      throw new WebHostProtocolError(
        `Transport failure for ${method}: HTTP ${response.status}.`,
      );
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new WebHostProtocolError(`Invalid JSON response for ${method}.`);
    }
    return parseServerResponse(body, rpcId, method) as T;
  }

  openDownlink(
    stream: WebHostStream,
    signal: AbortSignal,
    onFrame: (frame: WebHostServerRequest) => void,
  ): WebHostDownlink {
    const path = stream === "mux" ? "/api/events.mux" : "/api/events.host";
    const url = new URL(path, this.endpoint);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    const socket = this.webSocketFactory(url.href);
    let openedResolve!: () => void;
    let openedReject!: (error: Error) => void;
    let closedResolve!: () => void;
    let closedReject!: (error: Error) => void;
    let didOpen = false;
    let didClose = false;
    const opened = new Promise<void>((resolve, reject) => {
      openedResolve = resolve;
      openedReject = reject;
    });
    const closed = new Promise<void>((resolve, reject) => {
      closedResolve = resolve;
      closedReject = reject;
    });

    const cleanup = (): void => {
      signal.removeEventListener("abort", handleAbort);
      socket.removeEventListener("open", handleOpen);
      socket.removeEventListener("message", handleMessage);
      socket.removeEventListener("close", handleClose);
      socket.removeEventListener("error", handleError);
    };
    const finish = (error?: Error): void => {
      if (didClose) return;
      didClose = true;
      cleanup();
      if (!didOpen) {
        if (error) openedReject(error);
        else openedReject(new WebHostProtocolError(`${stream} downlink closed before open.`));
      }
      if (error) closedReject(error);
      else closedResolve();
    };
    const handleOpen = (): void => {
      if (didClose) return;
      didOpen = true;
      openedResolve();
    };
    const handleMessage = (event: MessageEvent): void => {
      try {
        if (typeof event.data !== "string") {
          throw new WebHostProtocolError(`Binary frame received on ${stream} downlink.`);
        }
        const frame = parseServerRequest(JSON.parse(event.data) as unknown, stream);
        onFrame(frame);
      } catch (error) {
        const protocolError =
          error instanceof WebHostProtocolError
            ? error
            : new WebHostProtocolError(`Malformed JSON frame on ${stream} downlink.`);
        socket.close();
        finish(protocolError);
      }
    };
    const handleClose = (): void => finish();
    const handleError = (): void =>
      finish(new WebHostProtocolError(`${stream} downlink transport error.`));
    const handleAbort = (): void => {
      socket.close();
      finish();
    };

    socket.addEventListener("open", handleOpen);
    socket.addEventListener("message", handleMessage);
    socket.addEventListener("close", handleClose);
    socket.addEventListener("error", handleError);
    signal.addEventListener("abort", handleAbort, { once: true });
    if (signal.aborted) handleAbort();

    return {
      url: url.href,
      opened,
      closed,
      close: handleAbort,
    };
  }
}
