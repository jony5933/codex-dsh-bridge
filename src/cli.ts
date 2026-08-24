#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { runTask } from "./runner.js";
import { readDshSessionMetrics } from "./benchmark/dsh-session.js";
import { WebHostClient } from "./harness/web-host/client.js";
import {
  parseWebProbeArguments,
  parseWebRunArguments,
  persistWebHostEvidence,
  prepareWebHostArtifactRoot,
} from "./harness/web-host/command.js";
import {
  persistWebHostCompatibilityEvidence,
  probeWebHostCompatibility,
} from "./harness/web-host/compatibility.js";
import {
  parseWebRunQueryArguments,
  queryWebHostRuns,
} from "./harness/web-host/index.js";
import { WebHostTransport } from "./harness/web-host/transport.js";
import { recordReviewArtifact } from "./review.js";
import { runCodexReviewAdapter } from "./reviewer/codex-cli.js";
import type { RunEvent } from "./types.js";
import { readBridgeVersion } from "./version.js";

function printUsage(): void {
  console.log("Usage:\n  codex-dsh web-run <project-path> <prompt.md> [--endpoint <origin>] [--timeout-ms <ms>] [--artifact-root <path>]\n  codex-dsh web-probe <project-path> [--endpoint <origin>] [--artifact-root <path>]\n  codex-dsh web-runs [--artifact-root <path>] [--project <path>] [--workspace <id>] [--session <id>] [--status <status>] [--since <iso>] [--until <iso>] [--limit <n>]\n  codex-dsh run <task-contract.json>\n  codex-dsh record-review <execution-evidence.json> <review-candidate.json>\n  codex-dsh codex-review <execution-evidence.json> <codex-command>\n  codex-dsh dsh-session-metrics <session.jsonl.zstd>");
}

async function main(): Promise<void> {
  const rawArguments = process.argv.slice(2);
  const argumentsWithoutSeparator = rawArguments[0] === "--" ? rawArguments.slice(1) : rawArguments;
  const [command, firstPath, secondPath] = argumentsWithoutSeparator;
  if (command === "--help" || command === "help") {
    printUsage();
    return;
  }
  if (command === "--version" || command === "version") {
    console.log(await readBridgeVersion());
    return;
  }
  if (command === "web-run") {
    try {
      const webRun = parseWebRunArguments(argumentsWithoutSeparator.slice(1));
      const prompt = await readFile(webRun.promptPath, "utf8");
      if (prompt.trim().length === 0) throw new Error("Web Host prompt file is empty.");
      const artifactRoot = await prepareWebHostArtifactRoot(
        webRun.projectPath,
        webRun.artifactRoot,
      );
      const sessionId = randomUUID();
      const client = new WebHostClient({ endpoint: webRun.endpoint });
      const compatibility = await probeWebHostCompatibility(client, {
        cwd: webRun.projectPath,
      });
      const persistedCompatibility = await persistWebHostCompatibilityEvidence(
        compatibility,
        artifactRoot,
        sessionId,
      );
      if (persistedCompatibility.status !== "compatible") {
        console.log(JSON.stringify(persistedCompatibility, null, 2));
        process.exitCode = 1;
        return;
      }
      const transport = new WebHostTransport({
        client,
      });
      const evidence = await transport.execute({
        mode: "web-direct",
        executionPath: webRun.projectPath,
        prompt,
        timeoutMs: webRun.timeoutMs,
        cancelTimeoutMs: 10_000,
        maxReconnects: 1,
        sessionId,
      });
      const persisted = await persistWebHostEvidence(
        evidence,
        artifactRoot,
        persistedCompatibility.probePath,
      );
      console.log(JSON.stringify(persisted, null, 2));
      if (evidence.status !== "completed") process.exitCode = 1;
    } catch (error) {
      const message = error instanceof Error ? error.stack ?? error.message : String(error);
      console.error(message);
      process.exitCode = 1;
    }
    return;
  }
  if (command === "web-probe") {
    try {
      const webProbe = parseWebProbeArguments(argumentsWithoutSeparator.slice(1));
      const artifactRoot = await prepareWebHostArtifactRoot(
        webProbe.projectPath,
        webProbe.artifactRoot,
      );
      const plannedSessionId = randomUUID();
      const compatibility = await probeWebHostCompatibility(
        new WebHostClient({ endpoint: webProbe.endpoint }),
        { cwd: webProbe.projectPath },
      );
      const persisted = await persistWebHostCompatibilityEvidence(
        compatibility,
        artifactRoot,
        plannedSessionId,
      );
      console.log(JSON.stringify(persisted, null, 2));
      if (persisted.status !== "compatible") process.exitCode = 1;
    } catch (error) {
      const message = error instanceof Error ? error.stack ?? error.message : String(error);
      console.error(message);
      process.exitCode = 1;
    }
    return;
  }
  if (command === "web-runs") {
    try {
      const query = parseWebRunQueryArguments(argumentsWithoutSeparator.slice(1));
      console.log(JSON.stringify(await queryWebHostRuns(query), null, 2));
    } catch (error) {
      const message = error instanceof Error ? error.stack ?? error.message : String(error);
      console.error(message);
      process.exitCode = 1;
    }
    return;
  }
  if (command === "dsh-session-metrics" && firstPath) {
    try {
      console.log(JSON.stringify(await readDshSessionMetrics(firstPath), null, 2));
    } catch (error) {
      const message = error instanceof Error ? error.stack ?? error.message : String(error);
      console.error(message);
      process.exitCode = 1;
    }
    return;
  }
  if (command === "record-review" && firstPath && secondPath) {
    try {
      const recorded = await recordReviewArtifact(firstPath, secondPath);
      console.log(JSON.stringify(recorded, null, 2));
    } catch (error) {
      const message = error instanceof Error ? error.stack ?? error.message : String(error);
      console.error(message);
      process.exitCode = 1;
    }
    return;
  }

  if (command === "codex-review" && firstPath && secondPath) {
    try {
      const result = await runCodexReviewAdapter(firstPath, {
        enabled: true,
        command: secondPath,
      });
      console.log(JSON.stringify(result, null, 2));
      if (result.execution.status !== "passed") process.exitCode = 1;
    } catch (error) {
      const message = error instanceof Error ? error.stack ?? error.message : String(error);
      console.error(message);
      process.exitCode = 1;
    }
    return;
  }

  if (command !== "run" || !firstPath) {
    printUsage();
    process.exitCode = 2;
    return;
  }

  try {
    const printEvent = (event: RunEvent): void => {
      process.stderr.write(`[${event.timestamp}] [${event.phase}] ${event.message}\n`);
    };
    const report = await runTask(firstPath, {
      onEvent: printEvent,
      onHarnessStdout: (chunk) => process.stderr.write(`[dsh:stdout] ${chunk}`),
      onHarnessStderr: (chunk) => process.stderr.write(`[dsh:stderr] ${chunk}`),
    });
    console.log(JSON.stringify(report, null, 2));
    if (report.status !== "passed") process.exitCode = 1;
  } catch (error) {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  }
}

await main();
