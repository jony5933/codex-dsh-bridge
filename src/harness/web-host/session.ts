import type {
  WebHostClient,
  WebHostDownlink,
  WebHostRpcMethod,
  WebHostServerRequest,
  WebHostStream,
} from "./client.js";
import {
  resolveWebHostWorkspace,
  verifyWebHostSessionWorkspace,
} from "./workspace.js";

interface SessionClient {
  readonly endpoint: string;
  call<T>(
    method: WebHostRpcMethod,
    payload: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<T>;
  openDownlink(
    stream: WebHostStream,
    signal: AbortSignal,
    onFrame: (frame: WebHostServerRequest) => void,
  ): WebHostDownlink;
}

export interface WebHostSessionRequest {
  sessionId: string;
  workspacePath: string;
  prompt: string;
  timeoutMs: number;
  cancelTimeoutMs?: number;
  maxReconnects?: number;
  agentPreset?: string;
}

export interface WebHostDescription {
  version: string;
  cwd: string;
  provider?: string;
  model?: string;
  attachedSessions: number;
  home: string;
  canOpenPath: boolean;
}

export interface WebHostSessionResult {
  outcome: "completed" | "failed";
  endpoint: string;
  host: WebHostDescription;
  workspaceId: string;
  workspacePath: string;
  workspaceCreated: boolean;
  reconnects: number;
  sessionId: string;
  promptAccepted: true;
  baselineLastSeq: number;
  terminalSeq: number;
  terminalReason: string;
  sawRunning: true;
  finalRunning: false;
}

export class WebHostSessionError extends Error {
  readonly code:
    | "invalid-response"
    | "connection-lost"
    | "stream-error"
    | "sequence-gap"
    | "agent-error"
    | "interaction-required"
    | "timeout"
    | "cancel-unconfirmed";

  constructor(code: WebHostSessionError["code"], message: string) {
    super(message);
    this.name = "WebHostSessionError";
    this.code = code;
  }
}

interface SessionEvent {
  type: string;
  seq: number;
  data: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new WebHostSessionError("invalid-response", `Invalid ${label} response.`);
  }
  return value;
}

function parseHostDescription(value: unknown): WebHostDescription {
  const host = requireRecord(value, "host.describe");
  if (
    typeof host.version !== "string" ||
    typeof host.cwd !== "string" ||
    typeof host.attachedSessions !== "number" ||
    !Number.isSafeInteger(host.attachedSessions) ||
    typeof host.home !== "string" ||
    typeof host.canOpenPath !== "boolean" ||
    (host.provider !== undefined && typeof host.provider !== "string") ||
    (host.model !== undefined && typeof host.model !== "string")
  ) {
    throw new WebHostSessionError("invalid-response", "Invalid host.describe response.");
  }
  return {
    version: host.version,
    cwd: host.cwd,
    attachedSessions: host.attachedSessions,
    home: host.home,
    canOpenPath: host.canOpenPath,
    ...(typeof host.provider === "string" ? { provider: host.provider } : {}),
    ...(typeof host.model === "string" ? { model: host.model } : {}),
  };
}

interface HistoryPage {
  events: SessionEvent[];
  hasMore: boolean;
}

function parseHistoryPage(value: unknown): HistoryPage {
  const history = requireRecord(value, "session.history");
  if (!Array.isArray(history.events) || typeof history.hasMore !== "boolean") {
    throw new WebHostSessionError("invalid-response", "Invalid session.history response.");
  }
  const events = history.events.map((entry, index) => {
    const record = requireRecord(entry, `session.history.events[${index}]`);
    const event = requireRecord(record.event, `session.history.events[${index}].event`);
    if (
      typeof event.type !== "string" ||
      typeof event.seq !== "number" ||
      !Number.isSafeInteger(event.seq) ||
      event.seq < 0 ||
      !isRecord(event.data)
    ) {
      throw new WebHostSessionError(
        "invalid-response",
        `Invalid event in session.history at index ${index}.`,
      );
    }
    return { type: event.type, seq: event.seq, data: event.data };
  });
  return { events, hasMore: history.hasMore };
}

function parseSessionRunning(value: unknown, sessionId: string): boolean {
  const list = requireRecord(value, "session.list");
  if (!Array.isArray(list.items)) {
    throw new WebHostSessionError("invalid-response", "Invalid session.list response.");
  }
  const matches = list.items.filter(
    (item) => isRecord(item) && item.sessionId === sessionId,
  );
  if (matches.length !== 1 || typeof matches[0]?.running !== "boolean") {
    throw new WebHostSessionError(
      "invalid-response",
      `session.list did not return exactly one running state for ${sessionId}.`,
    );
  }
  return matches[0].running;
}

function historyLastSeq(events: SessionEvent[]): number {
  return events.reduce((maximum, event) => Math.max(maximum, event.seq), -1);
}

function parseLiveEvent(payload: Record<string, unknown>): SessionEvent {
  const event = requireRecord(payload.event, "session/event payload");
  if (
    typeof event.type !== "string" ||
    typeof event.seq !== "number" ||
    !Number.isSafeInteger(event.seq) ||
    event.seq < 0 ||
    !isRecord(event.data)
  ) {
    throw new WebHostSessionError("invalid-response", "Invalid live session event.");
  }
  return { type: event.type, seq: event.seq, data: event.data };
}

function verifyTerminalHistory(
  events: SessionEvent[],
  baselineLastSeq: number,
  terminalSeq: number,
  terminalReason: string,
): void {
  const relevant = events
    .filter((event) => event.seq > baselineLastSeq && event.seq <= terminalSeq)
    .sort((left, right) => left.seq - right.seq);
  let expected = baselineLastSeq + 1;
  for (const event of relevant) {
    if (event.seq !== expected) {
      throw new WebHostSessionError(
        "sequence-gap",
        `History gap: expected seq ${expected}, received ${event.seq}.`,
      );
    }
    expected += 1;
  }
  if (expected !== terminalSeq + 1) {
    throw new WebHostSessionError(
      "sequence-gap",
      `History ended at seq ${expected - 1}; terminal seq is ${terminalSeq}.`,
    );
  }
  const terminal = relevant.find((event) => event.seq === terminalSeq);
  const reason = terminal?.data.reason;
  if (
    terminal?.type !== "turn/end" ||
    !isRecord(reason) ||
    reason.kind !== terminalReason
  ) {
    throw new WebHostSessionError(
      "invalid-response",
      "Final history does not contain the observed turn/end.",
    );
  }
}

export async function runWebHostSession(
  client: SessionClient | WebHostClient,
  request: WebHostSessionRequest,
): Promise<WebHostSessionResult> {
  if (
    request.sessionId.length === 0 ||
    request.workspacePath.length === 0 ||
    request.prompt.length === 0 ||
    !Number.isSafeInteger(request.timeoutMs) ||
    request.timeoutMs < 1 ||
    !Number.isSafeInteger(request.cancelTimeoutMs ?? 5_000) ||
    (request.cancelTimeoutMs ?? 5_000) < 1 ||
    !Number.isSafeInteger(request.maxReconnects ?? 1) ||
    (request.maxReconnects ?? 1) < 0
  ) {
    throw new WebHostSessionError("invalid-response", "Invalid Web Host session request.");
  }

  const controller = new AbortController();
  let deadlineTimer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    deadlineTimer = setTimeout(
      () =>
        reject(
          new WebHostSessionError(
            "timeout",
            `Web Host session timed out after ${request.timeoutMs} ms.`,
          ),
        ),
      request.timeoutMs,
    );
  });
  const withinDeadline = async <T>(operation: Promise<T>): Promise<T> =>
    await Promise.race([operation, deadline]);
  let mux: WebHostDownlink | undefined;
  let host: WebHostDownlink | undefined;
  let promptDispatched = false;
  let completed = false;
  let reconnects = 0;
  let connectionGeneration = 0;
  let recovering = false;
  let recoveryFailure: Error | undefined;
  let bufferedFrames: Array<{ stream: WebHostStream; frame: WebHostServerRequest }> = [];
  let baselineLastSeq = -1;
  let lastLiveSeq = -1;
  let activeTurn: number | undefined;
  let terminalSeq: number | undefined;
  let terminalReason: string | undefined;
  let sawRunning = false;
  let finalRunning = false;
  let finishResolve!: () => void;
  let finishReject!: (error: Error) => void;
  let finished!: Promise<void>;
  let idleResolve!: () => void;
  const idleAfterRunning = new Promise<void>((resolve) => {
    idleResolve = resolve;
  });
  let finishSettled = false;
  const resetFinished = (): void => {
    finishSettled = false;
    finished = new Promise<void>((resolve, reject) => {
      finishResolve = resolve;
      finishReject = reject;
    });
    void finished.catch(() => undefined);
  };
  resetFinished();
  const resolveIfComplete = (): void => {
    if (
      !finishSettled &&
      terminalSeq !== undefined &&
      sawRunning &&
      finalRunning === false
    ) {
      finishSettled = true;
      finishResolve();
    }
  };
  const fail = (error: Error): void => {
    if (finishSettled) return;
    finishSettled = true;
    finishReject(error);
  };

  const applySessionEvent = (event: SessionEvent): void => {
    if (event.seq <= lastLiveSeq) return;
    if (event.seq !== lastLiveSeq + 1) {
      throw new WebHostSessionError(
        "sequence-gap",
        `Live event gap: expected seq ${lastLiveSeq + 1}, received ${event.seq}.`,
      );
    }
    lastLiveSeq = event.seq;
    if (event.type === "turn/start" && typeof event.data.turn === "number") {
      sawRunning = true;
      activeTurn = event.data.turn;
    }
    if (
      event.type === "turn/end" &&
      typeof event.data.turn === "number" &&
      event.data.turn === activeTurn
    ) {
      const reason = event.data.reason;
      if (!isRecord(reason) || typeof reason.kind !== "string") {
        throw new WebHostSessionError("invalid-response", "turn/end has no valid reason.");
      }
      terminalSeq = event.seq;
      terminalReason = reason.kind;
      resolveIfComplete();
    }
  };

  const processMuxFrame = (frame: WebHostServerRequest): void => {
    const payload = frame.payload;
    if (
      typeof payload.sessionId === "string" &&
      payload.sessionId !== request.sessionId
    ) {
      return;
    }
    if (payload.type === "stream/error") {
      fail(new WebHostSessionError("stream-error", "Mux stream reported an error."));
      return;
    }
    if (payload.type === "approval/requested" || payload.type === "question/requested") {
      fail(
        new WebHostSessionError(
          "interaction-required",
          `Web Host requires interaction: ${payload.type}.`,
        ),
      );
      return;
    }
    if (payload.type !== "session/event" || payload.sessionId !== request.sessionId) return;
    try {
      applySessionEvent(parseLiveEvent(payload));
    } catch (error) {
      fail(error instanceof Error ? error : new Error(String(error)));
    }
  };

  const processHostFrame = (frame: WebHostServerRequest): void => {
    const payload = frame.payload;
    if (
      typeof payload.sessionId === "string" &&
      payload.sessionId !== request.sessionId
    ) {
      return;
    }
    if (payload.type === "stream/error") {
      fail(new WebHostSessionError("stream-error", "Host stream reported an error."));
      return;
    }
    if (payload.type === "host/agent-error" && payload.sessionId === request.sessionId) {
      fail(
        new WebHostSessionError(
          "agent-error",
          `Web Host agent error: ${String(payload.message)}.`,
        ),
      );
      return;
    }
    if (payload.type === "host/session-status" && payload.sessionId === request.sessionId) {
      if (payload.running === true) {
        sawRunning = true;
        finalRunning = true;
      } else if (payload.running === false && sawRunning) {
        finalRunning = false;
        idleResolve();
        resolveIfComplete();
      }
    }
  };

  const onMuxFrame = (frame: WebHostServerRequest): void => {
    if (recovering) {
      bufferedFrames.push({ stream: "mux", frame });
      return;
    }
    processMuxFrame(frame);
  };
  const onHostFrame = (frame: WebHostServerRequest): void => {
    if (recovering) {
      bufferedFrames.push({ stream: "host", frame });
      return;
    }
    processHostFrame(frame);
  };

  const handleConnectionClosed = (generation: number, error: Error): void => {
    if (generation !== connectionGeneration || controller.signal.aborted || completed) return;
    if (recovering) {
      recoveryFailure = error;
      return;
    }
    fail(error);
  };

  const installDownlinks = (): { mux: WebHostDownlink; host: WebHostDownlink } => {
    const generation = ++connectionGeneration;
    const nextMux = client.openDownlink("mux", controller.signal, onMuxFrame);
    const nextHost = client.openDownlink("host", controller.signal, onHostFrame);
    nextMux.closed.then(
      () =>
        handleConnectionClosed(
          generation,
          new WebHostSessionError("connection-lost", "Mux downlink closed."),
        ),
      (error: unknown) =>
        handleConnectionClosed(
          generation,
          error instanceof Error ? error : new Error(String(error)),
        ),
    );
    nextHost.closed.then(
      () =>
        handleConnectionClosed(
          generation,
          new WebHostSessionError("connection-lost", "Host downlink closed."),
        ),
      (error: unknown) =>
        handleConnectionClosed(
          generation,
          error instanceof Error ? error : new Error(String(error)),
        ),
    );
    mux = nextMux;
    host = nextHost;
    return { mux: nextMux, host: nextHost };
  };

  const readHistoryAfter = async (afterSeq: number): Promise<SessionEvent[]> => {
    const events = new Map<number, SessionEvent>();
    let beforeSeq: number | undefined;
    for (let pageIndex = 0; pageIndex < 10_000; pageIndex += 1) {
      const page = parseHistoryPage(
        await withinDeadline(
          client.call<unknown>(
            "session.history",
            {
              sessionId: request.sessionId,
              maxMessages: 100,
              ...(beforeSeq === undefined ? {} : { beforeSeq }),
            },
            controller.signal,
          ),
        ),
      );
      for (const event of page.events) events.set(event.seq, event);
      const minimumSeq = page.events.reduce(
        (minimum, event) => Math.min(minimum, event.seq),
        Number.POSITIVE_INFINITY,
      );
      if (!page.hasMore || minimumSeq <= afterSeq + 1) break;
      if (!Number.isFinite(minimumSeq) || minimumSeq === beforeSeq) {
        throw new WebHostSessionError(
          "invalid-response",
          "session.history pagination did not advance.",
        );
      }
      beforeSeq = minimumSeq;
    }
    return [...events.values()]
      .filter((event) => event.seq > afterSeq)
      .sort((left, right) => left.seq - right.seq);
  };

  const recoverConnections = async (): Promise<void> => {
    reconnects += 1;
    recovering = true;
    recoveryFailure = undefined;
    bufferedFrames = [];
    connectionGeneration += 1;
    mux?.close();
    host?.close();
    const next = installDownlinks();
    try {
      await withinDeadline(Promise.all([next.mux.opened, next.host.opened]));
      const missedEvents = await readHistoryAfter(lastLiveSeq);
      for (const event of missedEvents) applySessionEvent(event);
      const running = parseSessionRunning(
        await withinDeadline(
          client.call<unknown>("session.list", {}, controller.signal),
        ),
        request.sessionId,
      );
      if (recoveryFailure !== undefined) throw recoveryFailure;
      if (running) {
        sawRunning = true;
        finalRunning = true;
      } else {
        finalRunning = false;
        idleResolve();
      }
      recovering = false;
      const replay = bufferedFrames;
      bufferedFrames = [];
      for (const entry of replay) {
        if (entry.stream === "mux") processMuxFrame(entry.frame);
        else processHostFrame(entry.frame);
      }
      resolveIfComplete();
    } finally {
      recovering = false;
    }
  };

  try {
    const initial = installDownlinks();

    const [descriptionValue] = await withinDeadline(
      Promise.all([
        client.call<unknown>("host.describe", {}, controller.signal),
        initial.mux.opened,
        initial.host.opened,
      ]),
    );
    const description = parseHostDescription(descriptionValue);
    const workspaceResolution = await withinDeadline(
      resolveWebHostWorkspace(client, request.workspacePath, controller.signal),
    );
    const created = requireRecord(
      await withinDeadline(
        client.call<unknown>(
          "session.create",
          {
            sessionId: request.sessionId,
            workspaceId: workspaceResolution.workspace.workspaceId,
            ...(request.agentPreset === undefined
              ? {}
              : { agentPreset: request.agentPreset }),
          },
          controller.signal,
        ),
      ),
      "session.create",
    );
    if (created.sessionId !== request.sessionId) {
      throw new WebHostSessionError(
        "invalid-response",
        `session.create returned unexpected id: ${String(created.sessionId)}.`,
      );
    }
    await withinDeadline(
      verifyWebHostSessionWorkspace(
        client,
        workspaceResolution.workspace.workspaceId,
        workspaceResolution.canonicalPath,
        request.sessionId,
        controller.signal,
      ),
    );

    const baseline = parseHistoryPage(
      await withinDeadline(
        client.call<unknown>(
          "session.history",
          { sessionId: request.sessionId, maxMessages: 100 },
          controller.signal,
        ),
      ),
    );
    baselineLastSeq = historyLastSeq(baseline.events);
    lastLiveSeq = baselineLastSeq;

    if (finishSettled) await withinDeadline(finished);
    promptDispatched = true;
    const promptPromise = client.call<unknown>(
      "session.prompt",
      {
        sessionId: request.sessionId,
        mode: "queue",
        content: [{ type: "text", text: request.prompt }],
      },
      controller.signal,
    );
    const promptResult = requireRecord(
      await withinDeadline(promptPromise),
      "session.prompt",
    );
    if (promptResult.accepted !== true) {
      throw new WebHostSessionError("invalid-response", "session.prompt was not accepted.");
    }
    for (;;) {
      try {
        await withinDeadline(finished);
        break;
      } catch (error) {
        if (
          !(error instanceof WebHostSessionError) ||
          error.code !== "connection-lost" ||
          reconnects >= (request.maxReconnects ?? 1)
        ) {
          throw error;
        }
        resetFinished();
        await recoverConnections();
      }
    }
    if (
      terminalSeq === undefined ||
      terminalReason === undefined ||
      !sawRunning ||
      finalRunning
    ) {
      throw new WebHostSessionError("invalid-response", "Incomplete Web Host terminal state.");
    }

    const finalHistory = await readHistoryAfter(baselineLastSeq);
    verifyTerminalHistory(
      finalHistory,
      baselineLastSeq,
      terminalSeq,
      terminalReason,
    );
    completed = true;
    return {
      outcome: terminalReason === "completed" ? "completed" : "failed",
      endpoint: client.endpoint,
      host: description,
      workspaceId: workspaceResolution.workspace.workspaceId,
      workspacePath: workspaceResolution.canonicalPath,
      workspaceCreated: workspaceResolution.created,
      reconnects,
      sessionId: request.sessionId,
      promptAccepted: true,
      baselineLastSeq,
      terminalSeq,
      terminalReason,
      sawRunning: true,
      finalRunning: false,
    };
  } catch (error) {
    if (promptDispatched && !completed) {
      try {
        const cancelled = requireRecord(
          await client.call("session.cancel", { sessionId: request.sessionId }),
          "session.cancel",
        );
        if (cancelled.accepted !== true) {
          throw new WebHostSessionError(
            "cancel-unconfirmed",
            "session.cancel was not accepted.",
          );
        }
        let cancelTimer: NodeJS.Timeout | undefined;
        const cancelTimeout = new Promise<never>((_resolve, reject) => {
          cancelTimer = setTimeout(
            () =>
              reject(
                new WebHostSessionError(
                  "cancel-unconfirmed",
                  "Host did not confirm running:false after session.cancel.",
                ),
              ),
            request.cancelTimeoutMs ?? 5_000,
          );
        });
        try {
          await Promise.race([idleAfterRunning, cancelTimeout]);
        } finally {
          if (cancelTimer) clearTimeout(cancelTimer);
        }
      } catch (cancelError) {
        const originalMessage =
          error instanceof Error ? error.message : String(error);
        const cancelMessage =
          cancelError instanceof Error ? cancelError.message : String(cancelError);
        throw new WebHostSessionError(
          "cancel-unconfirmed",
          `${originalMessage} Cancellation could not be confirmed: ${cancelMessage}`,
        );
      }
    }
    throw error;
  } finally {
    if (deadlineTimer) clearTimeout(deadlineTimer);
    controller.abort();
  }
}
