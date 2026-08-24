import assert from "node:assert/strict";
import { zstdCompressSync } from "node:zlib";
import { describe, it } from "node:test";
import { extractDshSessionMetrics } from "../src/benchmark/dsh-session.js";

describe("DSH rc.8 session metrics", () => {
  it("sums assistant usage across concatenated Zstandard frames", () => {
    const header = zstdCompressSync(`${JSON.stringify({ type: "session", data: {} })}\n`);
    const events = [
      {
        type: "assistant/message",
        data: {
          message: { source: { model: "deepseek-v4-flash" } },
          usage: { inputTokens: 10, outputTokens: 3, cacheReadTokens: 4, reasoningTokens: 2 },
        },
      },
      { type: "tool/result", data: {} },
      {
        type: "assistant/message",
        data: {
          message: { source: { model: "deepseek-v4-flash" } },
          usage: { inputTokens: 5, outputTokens: 7, cacheReadTokens: 8, reasoningTokens: 1 },
        },
      },
    ];
    const body = zstdCompressSync(`${events.map((event) => JSON.stringify(event)).join("\n")}\n`);

    assert.deepEqual(extractDshSessionMetrics(Buffer.concat([header, body])), {
      model: "deepseek-v4-flash",
      modelCalls: 2,
      inputTokens: 15,
      outputTokens: 10,
      cacheReadTokens: 12,
      reasoningTokens: 3,
      eventCount: 4,
      frameCount: 2,
    });
  });

  it("rejects malformed frame data", () => {
    assert.throws(() => extractDshSessionMetrics(Buffer.from("not-zstd")), /Invalid Zstandard/);
  });
});
