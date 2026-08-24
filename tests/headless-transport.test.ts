import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { HeadlessTransport } from "../src/harness/headless.js";
import type { TaskContract } from "../src/types.js";

function contract(command: string, script: string): TaskContract {
  return {
    version: 1,
    taskId: "headless-transport",
    repository: ".",
    baseCommit: "HEAD",
    objective: "Verify the headless transport preserves execution behavior.",
    allowedPaths: ["src/**"],
    forbiddenPaths: [],
    acceptanceCriteria: ["All placeholders and callbacks remain stable"],
    baselineChecks: [],
    requiredChecks: [],
    acceptanceChecks: [],
    instructions: "",
    harness: {
      command,
      args: [script, "{worktree}", "{skillPatch}", "{prompt}"],
      timeoutMs: 10_000,
    },
    execution: {
      keepWorktree: true,
    },
    lineage: {
      contractPath: "task.json",
      rootContractPath: "task.json",
      iteration: 0,
      findings: [],
      history: [],
    },
  };
}

describe("HeadlessTransport", () => {
  it("preserves placeholders, environment, callbacks, and command evidence", async () => {
    const worktree = await mkdtemp(join(tmpdir(), "headless-transport-"));
    const script = join(worktree, "fake-harness.mjs");
    await writeFile(
      script,
      [
        "const [, , worktree, skillPatch, prompt] = process.argv;",
        'process.stdout.write(JSON.stringify({ worktree, skillPatch, prompt, marker: process.env.TRANSPORT_MARKER }));',
        'process.stderr.write("diagnostic");',
      ].join("\n"),
    );
    const stdout: string[] = [];
    const stderr: string[] = [];
    const transport = new HeadlessTransport();

    const result = await transport.execute({
      contract: contract(process.execPath, script),
      worktree,
      prompt: "中文任务 + technical terms",
      skillPatch: "/tmp/skill patch.yml",
      output: {
        env: { ...process.env, TRANSPORT_MARKER: "kept" },
        onStdout: (chunk) => stdout.push(chunk),
        onStderr: (chunk) => stderr.push(chunk),
      },
    });

    assert.equal(transport.kind, "headless");
    assert.equal(result.exitCode, 0);
    assert.equal(result.timedOut, false);
    assert.equal(result.cwd, worktree);
    assert.deepEqual(JSON.parse(result.stdout), {
      worktree,
      skillPatch: "/tmp/skill patch.yml",
      prompt: "中文任务 + technical terms",
      marker: "kept",
    });
    assert.equal(stdout.join(""), result.stdout);
    assert.equal(stderr.join(""), "diagnostic");
    assert.equal(result.stderr, "diagnostic");
  });
});
