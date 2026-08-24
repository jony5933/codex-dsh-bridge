import assert from "node:assert/strict";
import { realpathSync } from "node:fs";
import { describe, it } from "node:test";
import type {
  WebHostDownlink,
  WebHostRpcMethod,
  WebHostServerRequest,
  WebHostStream,
} from "../src/harness/web-host/client.js";
import {
  runWebHostSession,
  WebHostSessionError,
} from "../src/harness/web-host/session.js";

type FrameHandler = (frame: WebHostServerRequest) => void;

class FakeSessionClient {
  readonly endpoint = "http://127.0.0.1:3080";
  readonly calls: WebHostRpcMethod[] = [];
  readonly payloads: Array<{ method: WebHostRpcMethod; payload: Record<string, unknown> }> = [];
  readonly handlers = new Map<WebHostStream, FrameHandler>();
  readonly historyEvents: Array<{ event: Record<string, unknown> }> = [];
  readonly closeResolvers = new Map<WebHostStream, () => void>();
  mode:
    | "complete"
    | "long-complete"
    | "gap"
    | "approval"
    | "question"
    | "agent-error"
    | "disconnect"
    | "disconnect-history-only"
    | "disconnect-gap"
    | "timeout" = "complete";
  cancelSettles = true;
  workspaceExists = false;
  attachSession = true;
  sessionAttached = false;
  workspacePath = realpathSync(process.cwd());
  running = false;
  closeOnOpen = false;

  openDownlink(
    stream: WebHostStream,
    _signal: AbortSignal,
    onFrame: FrameHandler,
  ): WebHostDownlink {
    this.handlers.set(stream, onFrame);
    let closeResolve!: () => void;
    const closed = this.closeOnOpen
      ? Promise.resolve()
      : new Promise<void>((resolve) => {
          closeResolve = resolve;
        });
    if (this.closeOnOpen) closeResolve = () => undefined;
    this.closeResolvers.set(stream, closeResolve);
    return {
      url: `ws://127.0.0.1:3080/api/events.${stream}`,
      opened: Promise.resolve(),
      closed,
      close: closeResolve,
    };
  }

  closeStream(stream: WebHostStream): void {
    this.closeResolvers.get(stream)?.();
  }

  emit(stream: WebHostStream, payload: Record<string, unknown>): void {
    this.handlers.get(stream)?.({
      type: "server-request",
      rpcId: `push-${String(payload.type)}`,
      method: String(payload.type),
      payload,
    });
  }

  event(type: string, seq: number, data: Record<string, unknown>): void {
    const event = { type, seq, time: 1_700_000_000_000 + seq, data };
    this.historyEvents.push({ event });
    this.emit("mux", {
      type: "session/event",
      sessionId: "session-test",
      event,
    });
  }

  recordEvent(type: string, seq: number, data: Record<string, unknown>): void {
    this.historyEvents.push({
      event: { type, seq, time: 1_700_000_000_000 + seq, data },
    });
  }

  async call<T>(
    method: WebHostRpcMethod,
    payload: Record<string, unknown>,
  ): Promise<T> {
    this.calls.push(method);
    this.payloads.push({ method, payload });
    switch (method) {
      case "host.describe":
        return {
          version: "0.0.1",
          cwd: "/fake/host",
          provider: "fake-provider",
          model: "fake-model",
          attachedSessions: 0,
          home: "/fake",
          canOpenPath: false,
        } as T;
      case "session.create":
        this.sessionAttached = this.attachSession;
        return { sessionId: "session-test" } as T;
      case "session.history":
        const beforeSeq =
          typeof payload.beforeSeq === "number"
            ? payload.beforeSeq
            : Number.POSITIVE_INFINITY;
        const maxMessages =
          typeof payload.maxMessages === "number" ? payload.maxMessages : 100;
        const eligible = this.historyEvents.filter(({ event }) => {
          const seq = event.seq;
          return typeof seq === "number" && seq < beforeSeq;
        });
        const page = eligible.slice(-maxMessages);
        return {
          events: page,
          hasMore: eligible.length > page.length,
        } as T;
      case "session.prompt":
        queueMicrotask(() => {
          if (this.mode === "disconnect-history-only") {
            this.closeStream("mux");
            this.recordEvent("turn/start", 0, { turn: 0 });
            this.recordEvent("turn/end", 1, {
              turn: 0,
              reason: { kind: "completed" },
            });
            this.running = false;
            return;
          }
          this.running = true;
          this.emit("host", {
            type: "host/session-status",
            sessionId: "session-test",
            running: true,
          });
          this.event("turn/start", 0, { turn: 0 });
          switch (this.mode) {
            case "gap":
              this.event("turn/end", 2, {
                turn: 0,
                reason: { kind: "completed" },
              });
              break;
            case "approval":
              this.emit("mux", {
                type: "approval/requested",
                sessionId: "session-test",
                approvalId: "approval-1",
                toolName: "bash",
              });
              break;
            case "question":
              this.emit("mux", {
                type: "question/requested",
                sessionId: "session-test",
                questions: [{ id: "q1", question: "Continue?" }],
              });
              break;
            case "agent-error":
              this.emit("host", {
                type: "host/agent-error",
                sessionId: "session-test",
                message: "provider failed",
              });
              break;
            case "disconnect":
              this.closeStream("mux");
              this.recordEvent("turn/end", 1, {
                turn: 0,
                reason: { kind: "completed" },
              });
              this.running = false;
              break;
            case "disconnect-gap":
              this.closeStream("mux");
              this.recordEvent("turn/end", 2, {
                turn: 0,
                reason: { kind: "completed" },
              });
              this.running = false;
              break;
            case "timeout":
              break;
            case "complete":
              this.event("turn/end", 1, {
                turn: 0,
                reason: { kind: "completed" },
              });
              this.emit("host", {
                type: "host/session-status",
                sessionId: "session-test",
                running: false,
              });
              this.running = false;
              break;
            case "long-complete":
              for (let seq = 1; seq < 150; seq += 1) {
                this.event("assistant/message", seq, { text: `event-${seq}` });
              }
              this.event("turn/end", 150, {
                turn: 0,
                reason: { kind: "completed" },
              });
              this.emit("host", {
                type: "host/session-status",
                sessionId: "session-test",
                running: false,
              });
              this.running = false;
              break;
          }
        });
        return { accepted: true } as T;
      case "session.cancel":
        this.running = false;
        if (this.cancelSettles) {
          queueMicrotask(() => {
            this.emit("host", {
              type: "host/session-status",
              sessionId: "session-test",
              running: false,
            });
          });
        }
        return { accepted: true } as T;
      case "session.list":
        return {
          items: [
            {
              sessionId: "session-test",
              updatedAt: 1_700_000_000_000,
              running: this.running,
              blank: false,
              cwd: this.workspacePath,
            },
          ],
        } as T;
      case "workspace.list":
        return {
          items: this.workspaceExists
            ? [
                {
                  workspaceId: "workspace-test",
                  path: this.workspacePath,
                  title: "Test Workspace",
                  sessionIds: this.sessionAttached ? ["session-test"] : [],
                  createdAt: "2026-08-21T00:00:00.000Z",
                  updatedAt: "2026-08-21T00:00:00.000Z",
                },
              ]
            : [],
          archivedSessionIds: [],
        } as T;
      case "workspace.create":
        this.workspaceExists = true;
        return {
          workspace: {
            workspaceId: "workspace-test",
            path: this.workspacePath,
            title: "Test Workspace",
            sessionIds: [],
            createdAt: "2026-08-21T00:00:00.000Z",
            updatedAt: "2026-08-21T00:00:00.000Z",
          },
          created: true,
        } as T;
    }
  }
}

const request = {
  sessionId: "session-test",
  workspacePath: process.cwd(),
  prompt: "请执行任务并保留 technical identifiers。",
  timeoutMs: 1_000,
};

describe("runWebHostSession", () => {
  it("requires a contiguous completed turn, idle Host, and final history", async () => {
    const client = new FakeSessionClient();

    const result = await runWebHostSession(client, request);

    assert.deepEqual(result, {
      outcome: "completed",
      endpoint: "http://127.0.0.1:3080",
      host: {
        version: "0.0.1",
        cwd: "/fake/host",
        provider: "fake-provider",
        model: "fake-model",
        attachedSessions: 0,
        home: "/fake",
        canOpenPath: false,
      },
      workspaceId: "workspace-test",
      workspacePath: realpathSync(process.cwd()),
      workspaceCreated: true,
      reconnects: 0,
      sessionId: "session-test",
      promptAccepted: true,
      baselineLastSeq: -1,
      terminalSeq: 1,
      terminalReason: "completed",
      sawRunning: true,
      finalRunning: false,
    });
    assert.deepEqual(client.calls, [
      "host.describe",
      "workspace.list",
      "workspace.create",
      "session.create",
      "workspace.list",
      "session.history",
      "session.prompt",
      "session.history",
    ]);
    assert.deepEqual(
      client.payloads.find(({ method }) => method === "session.create")?.payload,
      { sessionId: "session-test", workspaceId: "workspace-test" },
    );
  });

  it("reuses an existing canonical Workspace without creating another", async () => {
    const client = new FakeSessionClient();
    client.workspaceExists = true;

    const result = await runWebHostSession(client, request);

    assert.equal(result.workspaceCreated, false);
    assert.equal(client.calls.includes("workspace.create"), false);
  });

  it("paginates final history until the baseline sequence is covered", async () => {
    const client = new FakeSessionClient();
    client.mode = "long-complete";

    const result = await runWebHostSession(client, request);

    assert.equal(result.terminalSeq, 150);
    assert.equal(
      client.calls.filter((method) => method === "session.history").length,
      3,
    );
    assert.deepEqual(
      client.payloads
        .filter(({ method }) => method === "session.history")
        .map(({ payload }) => payload.beforeSeq),
      [undefined, undefined, 51],
    );
  });

  it("fails before prompt when session attachment cannot be verified", async () => {
    const client = new FakeSessionClient();
    client.attachSession = false;

    await assert.rejects(
      runWebHostSession(client, request),
      /is not attached to Workspace workspace-test/,
    );
    assert.equal(client.calls.includes("session.prompt"), false);
    assert.equal(client.calls.includes("session.cancel"), false);
  });

  it("does not send prompt when a downlink closes during setup", async () => {
    const client = new FakeSessionClient();
    client.closeOnOpen = true;

    await assert.rejects(
      runWebHostSession(client, request),
      (error) =>
        error instanceof WebHostSessionError && error.code === "connection-lost",
    );
    assert.equal(client.calls.includes("session.prompt"), false);
    assert.equal(client.calls.includes("session.cancel"), false);
  });

  it("fails closed and cancels after an accepted prompt develops a seq gap", async () => {
    const client = new FakeSessionClient();
    client.mode = "gap";

    await assert.rejects(
      runWebHostSession(client, request),
      (error) =>
        error instanceof WebHostSessionError &&
        error.code === "sequence-gap" &&
        /expected seq 1, received 2/.test(error.message),
    );
    assert.equal(client.calls.at(-1), "session.cancel");
    assert.equal(
      client.calls.filter((method) => method === "session.prompt").length,
      1,
    );
  });

  it("blocks approval and question requests without inventing responses", async () => {
    for (const mode of ["approval", "question"] as const) {
      const client = new FakeSessionClient();
      client.mode = mode;

      await assert.rejects(
        runWebHostSession(client, request),
        (error) =>
          error instanceof WebHostSessionError &&
          error.code === "interaction-required",
      );
      assert.equal(client.calls.at(-1), "session.cancel");
      assert.equal(
        client.calls.filter((method) => method === "session.prompt").length,
        1,
      );
    }
  });

  it("fails closed for a Host agent error and confirms cancellation", async () => {
    const client = new FakeSessionClient();
    client.mode = "agent-error";

    await assert.rejects(
      runWebHostSession(client, request),
      (error) =>
        error instanceof WebHostSessionError &&
        error.code === "agent-error" &&
        /provider failed/.test(error.message),
    );
    assert.equal(client.calls.at(-1), "session.cancel");
  });

  it("recovers a downlink disconnect from history without sending prompt twice", async () => {
    const client = new FakeSessionClient();
    client.mode = "disconnect";

    const result = await runWebHostSession(client, request);

    assert.equal(result.reconnects, 1);
    assert.equal(result.terminalSeq, 1);
    assert.equal(
      client.calls.filter((method) => method === "session.prompt").length,
      1,
    );
    assert.equal(client.calls.includes("session.cancel"), false);
    assert.equal(client.calls.includes("session.list"), true);
  });

  it("recovers when running state was missed but history contains the complete turn", async () => {
    const client = new FakeSessionClient();
    client.mode = "disconnect-history-only";

    const result = await runWebHostSession(client, request);

    assert.equal(result.reconnects, 1);
    assert.equal(result.sawRunning, true);
    assert.equal(result.terminalReason, "completed");
  });

  it("fails closed when recovery history contains a sequence gap", async () => {
    const client = new FakeSessionClient();
    client.mode = "disconnect-gap";

    await assert.rejects(
      runWebHostSession(client, request),
      (error) =>
        error instanceof WebHostSessionError &&
        error.code === "sequence-gap" &&
        /expected seq 1, received 2/.test(error.message),
    );
    assert.equal(client.calls.at(-1), "session.cancel");
    assert.equal(
      client.calls.filter((method) => method === "session.prompt").length,
      1,
    );
  });

  it("keeps disconnects fail-closed when recovery is disabled", async () => {
    const client = new FakeSessionClient();
    client.mode = "disconnect";

    await assert.rejects(
      runWebHostSession(client, { ...request, maxReconnects: 0 }),
      (error) =>
        error instanceof WebHostSessionError && error.code === "connection-lost",
    );
    assert.equal(client.calls.at(-1), "session.cancel");
  });

  it("applies one deadline to the whole session and settles cancellation", async () => {
    const client = new FakeSessionClient();
    client.mode = "timeout";

    await assert.rejects(
      runWebHostSession(client, {
        ...request,
        timeoutMs: 20,
        cancelTimeoutMs: 100,
      }),
      (error) =>
        error instanceof WebHostSessionError &&
        error.code === "timeout" &&
        /timed out after 20 ms/.test(error.message),
    );
    assert.equal(client.calls.at(-1), "session.cancel");
  });

  it("reports cancel-unconfirmed when Host never returns to idle", async () => {
    const client = new FakeSessionClient();
    client.mode = "approval";
    client.cancelSettles = false;

    await assert.rejects(
      runWebHostSession(client, {
        ...request,
        cancelTimeoutMs: 20,
      }),
      (error) =>
        error instanceof WebHostSessionError &&
        error.code === "cancel-unconfirmed" &&
        /did not confirm running:false/.test(error.message),
    );
    assert.equal(client.calls.at(-1), "session.cancel");
  });
});
