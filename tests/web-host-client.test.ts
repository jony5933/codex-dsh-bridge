import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  WebHostClient,
  WebHostProtocolError,
  WebHostRpcError,
  type WebSocketLike,
} from "../src/harness/web-host/client.js";

type Listener = (event: never) => void;

class FakeWebSocket implements WebSocketLike {
  readonly listeners = new Map<string, Set<Listener>>();
  closed = false;

  addEventListener(type: string, listener: Listener): void {
    const listeners = this.listeners.get(type) ?? new Set<Listener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener);
  }

  close(): void {
    this.closed = true;
  }

  emit(type: string, event: unknown = {}): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event as never);
  }
}

describe("WebHostClient", () => {
  it("allows only explicit loopback origins", () => {
    assert.throws(
      () => new WebHostClient({ endpoint: "http://192.168.1.20:3080" }),
      /must be loopback/,
    );
    assert.throws(
      () => new WebHostClient({ endpoint: "file:///tmp/dsh" }),
      /must use http or https/,
    );
    assert.throws(
      () => new WebHostClient({ endpoint: "http://127.0.0.1:3080/api" }),
      /must be an origin/,
    );
    assert.equal(
      new WebHostClient({ endpoint: "http://localhost:3080/" }).endpoint,
      "http://localhost:3080",
    );
  });

  it("exposes only the M7 RPC allowlist", async () => {
    const client = new WebHostClient({
      fetch: async () => assert.fail("disallowed methods must not reach fetch"),
    });
    await assert.rejects(
      client.call("settings.describe" as "host.describe", {}),
      /not allowed by the M7 adapter/,
    );

    const allowedMethods: string[] = [];
    const workspaceClient = new WebHostClient({
      createRpcId: () => "rpc-workspace",
      fetch: async (input) => {
        allowedMethods.push(String(input).split("/api/")[1] ?? "");
        return Response.json({
          type: "server-response",
          rpcId: "rpc-workspace",
          result: { ok: true, value: {} },
        });
      },
    });
    await workspaceClient.call("workspace.list", {});
    await workspaceClient.call("workspace.create", { path: "/canonical/project" });
    assert.deepEqual(allowedMethods, ["workspace.list", "workspace.create"]);
  });

  it("sends the rc.8 unary envelope and validates the rpcId echo", async () => {
    let observedUrl = "";
    let observedBody: unknown;
    const client = new WebHostClient({
      endpoint: "http://127.0.0.1:3080",
      createRpcId: () => "rpc-fixed",
      fetch: async (input, init) => {
        observedUrl = String(input);
        observedBody = JSON.parse(String(init?.body));
        return Response.json({
          type: "server-response",
          rpcId: "rpc-fixed",
          result: { ok: true, value: { version: "0.0.1" } },
        });
      },
    });

    const value = await client.call<{ version: string }>("host.describe", {});

    assert.equal(observedUrl, "http://127.0.0.1:3080/api/host.describe");
    assert.deepEqual(observedBody, {
      type: "client-request",
      rpcId: "rpc-fixed",
      method: "host.describe",
      payload: {},
    });
    assert.deepEqual(value, { version: "0.0.1" });
  });

  it("fails closed for mismatched correlation and RPC errors", async () => {
    const mismatch = new WebHostClient({
      createRpcId: () => "rpc-sent",
      fetch: async () =>
        Response.json({
          type: "server-response",
          rpcId: "rpc-other",
          result: { ok: true, value: {} },
        }),
    });
    await assert.rejects(mismatch.call("session.list", {}), /rpcId mismatch/);

    const rejected = new WebHostClient({
      createRpcId: () => "rpc-error",
      fetch: async () =>
        Response.json({
          type: "server-response",
          rpcId: "rpc-error",
          result: {
            ok: false,
            error: {
              code: "session-conflict",
              message: "cwd differs",
              details: { sessionId: "session-1" },
            },
          },
        }),
    });
    await assert.rejects(
      rejected.call("session.create", {}),
      (error) =>
        error instanceof WebHostRpcError &&
        error.code === "session-conflict" &&
        error.message === "session-conflict: cwd differs",
    );
  });

  it("opens both rc.8 downlink paths and validates server-request frames", async () => {
    const sockets: Array<{ url: string; socket: FakeWebSocket }> = [];
    const client = new WebHostClient({
      endpoint: "http://127.0.0.1:3080",
      createWebSocket: (url) => {
        const socket = new FakeWebSocket();
        sockets.push({ url, socket });
        return socket;
      },
    });
    const controller = new AbortController();
    const frames: unknown[] = [];
    const mux = client.openDownlink("mux", controller.signal, (frame) => frames.push(frame));
    const host = client.openDownlink("host", controller.signal, (frame) => frames.push(frame));
    sockets[0]?.socket.emit("open");
    sockets[1]?.socket.emit("open");
    await Promise.all([mux.opened, host.opened]);

    sockets[0]?.socket.emit("message", {
      data: JSON.stringify({
        type: "server-request",
        rpcId: "push-1",
        method: "session/subscribed",
        payload: {
          type: "session/subscribed",
          sessionId: "session-1",
          lastSeq: 41,
        },
      }),
    });

    assert.deepEqual(
      sockets.map(({ url }) => url),
      [
        "ws://127.0.0.1:3080/api/events.mux",
        "ws://127.0.0.1:3080/api/events.host",
      ],
    );
    assert.deepEqual(frames, [
      {
        type: "server-request",
        rpcId: "push-1",
        method: "session/subscribed",
        payload: {
          type: "session/subscribed",
          sessionId: "session-1",
          lastSeq: 41,
        },
      },
    ]);

    controller.abort();
    await Promise.all([mux.closed, host.closed]);
    assert.equal(sockets.every(({ socket }) => socket.closed), true);
  });

  it("closes and rejects a downlink on malformed frames", async () => {
    const socket = new FakeWebSocket();
    const client = new WebHostClient({
      createWebSocket: () => socket,
    });
    const downlink = client.openDownlink("mux", new AbortController().signal, () => {
      assert.fail("malformed frames must not reach the consumer");
    });
    socket.emit("open");
    await downlink.opened;
    socket.emit("message", { data: "{not-json" });

    await assert.rejects(downlink.closed, WebHostProtocolError);
    assert.equal(socket.closed, true);
  });

  it("rejects a valid envelope carrying a frame on the wrong stream", async () => {
    const socket = new FakeWebSocket();
    const client = new WebHostClient({
      createWebSocket: () => socket,
    });
    const downlink = client.openDownlink("host", new AbortController().signal, () => {
      assert.fail("wrong-stream frames must not reach the consumer");
    });
    socket.emit("open");
    await downlink.opened;
    socket.emit("message", {
      data: JSON.stringify({
        type: "server-request",
        rpcId: "push-wrong-stream",
        method: "session/subscribed",
        payload: {
          type: "session/subscribed",
          sessionId: "session-1",
          lastSeq: 41,
        },
      }),
    });

    await assert.rejects(downlink.closed, /Invalid host frame method\/type pair/);
    assert.equal(socket.closed, true);
  });
});
