import { readFile } from "node:fs/promises";
import { zstdDecompressSync } from "node:zlib";

const ZSTD_MAGIC = 4_247_762_216;

export interface DshSessionMetrics {
  model: string | null;
  modelCalls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  reasoningTokens: number;
  eventCount: number;
  frameCount: number;
}

function scanZstdFrames(buffer: Buffer): Array<{ start: number; end: number }> {
  const frames: Array<{ start: number; end: number }> = [];
  let offset = 0;
  while (offset < buffer.length) {
    const start = offset;
    if (buffer.length - offset < 5 || buffer.readUInt32LE(offset) !== ZSTD_MAGIC) {
      throw new Error(`Invalid Zstandard session frame at byte ${offset}`);
    }
    offset += 4;
    const descriptor = buffer.readUInt8(offset++);
    if ((descriptor & 24) !== 0) throw new Error(`Invalid Zstandard frame descriptor at byte ${offset - 1}`);
    const contentSizeFlag = descriptor >>> 6;
    const singleSegment = (descriptor & 32) !== 0;
    const checksum = (descriptor & 4) !== 0;
    const dictionaryFlag = descriptor & 3;
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag;
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag;
    const headerBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes;
    if (buffer.length - offset < headerBytes) throw new Error(`Incomplete Zstandard frame header at byte ${start}`);
    offset += headerBytes;

    for (;;) {
      if (buffer.length - offset < 3) throw new Error(`Incomplete Zstandard block header at byte ${start}`);
      const blockHeader = buffer.readUIntLE(offset, 3);
      offset += 3;
      const lastBlock = (blockHeader & 1) !== 0;
      const blockType = (blockHeader >>> 1) & 3;
      const blockSize = blockHeader >>> 3;
      if (blockType === 3) throw new Error(`Invalid Zstandard block type at byte ${offset - 3}`);
      const payloadBytes = blockType === 1 ? 1 : blockSize;
      if (buffer.length - offset < payloadBytes) throw new Error(`Incomplete Zstandard block at byte ${start}`);
      offset += payloadBytes;
      if (lastBlock) break;
    }
    if (checksum) {
      if (buffer.length - offset < 4) throw new Error(`Incomplete Zstandard checksum at byte ${start}`);
      offset += 4;
    }
    frames.push({ start, end: offset });
  }
  return frames;
}

export function extractDshSessionMetrics(buffer: Buffer): DshSessionMetrics {
  const frames = scanZstdFrames(buffer);
  const text = frames
    .map(({ start, end }) => zstdDecompressSync(buffer.subarray(start, end)).toString("utf8"))
    .join("");
  const lines = text.split("\n").filter((line) => line.trim());
  const metrics: DshSessionMetrics = {
    model: null,
    modelCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    reasoningTokens: 0,
    eventCount: lines.length,
    frameCount: frames.length,
  };

  for (const line of lines) {
    const event = JSON.parse(line) as {
      type?: string;
      data?: {
        message?: { source?: { model?: string } };
        usage?: Partial<Record<"inputTokens" | "outputTokens" | "cacheReadTokens" | "reasoningTokens", number>>;
      };
    };
    if (event.type !== "assistant/message" || event.data?.usage === undefined) continue;
    const model = event.data.message?.source?.model;
    if (model !== undefined && metrics.model !== null && metrics.model !== model) {
      throw new Error(`Session contains multiple models: ${metrics.model}, ${model}`);
    }
    if (model !== undefined) metrics.model = model;
    metrics.modelCalls += 1;
    metrics.inputTokens += event.data.usage.inputTokens ?? 0;
    metrics.outputTokens += event.data.usage.outputTokens ?? 0;
    metrics.cacheReadTokens += event.data.usage.cacheReadTokens ?? 0;
    metrics.reasoningTokens += event.data.usage.reasoningTokens ?? 0;
  }
  return metrics;
}

export async function readDshSessionMetrics(path: string): Promise<DshSessionMetrics> {
  return extractDshSessionMetrics(await readFile(path));
}
