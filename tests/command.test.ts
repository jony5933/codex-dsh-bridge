import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { createCheckEnvironment, runCommand } from "../src/lib/command.js";

describe("runCommand", () => {
  it("keeps only non-secret environment variables for checks", () => {
    const environment = createCheckEnvironment({
      PATH: "/usr/bin:/bin",
      HOME: "/tmp/test-home",
      LANG: "zh_CN.UTF-8",
      LC_ALL: "C",
      DEEPSEEK_API_KEY: "secret-deepseek",
      OPENAI_API_KEY: "secret-openai",
      GITHUB_TOKEN: "secret-github",
      AWS_SECRET_ACCESS_KEY: "secret-aws",
      SSH_AUTH_SOCK: "/tmp/agent.sock",
      DSH_SESSION_ID: "private-session",
      UNRELATED_CUSTOM_VALUE: "not-required-by-checks",
    });

    assert.deepEqual(environment, {
      PATH: "/usr/bin:/bin",
      HOME: "/tmp/test-home",
      LANG: "zh_CN.UTF-8",
      LC_ALL: "C",
    });
  });

  it("streams stdout and stderr while preserving the complete result", async () => {
    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];

    const result = await runCommand(
      process.execPath,
      ["-e", 'process.stdout.write("working\\n"); process.stderr.write("warning\\n")'],
      {
        cwd: process.cwd(),
        onStdout: (chunk) => stdoutChunks.push(chunk),
        onStderr: (chunk) => stderrChunks.push(chunk),
      },
    );

    assert.equal(result.exitCode, 0);
    assert.equal(stdoutChunks.join(""), "working\n");
    assert.equal(stderrChunks.join(""), "warning\n");
    assert.equal(result.stdout, "working\n");
    assert.equal(result.stderr, "warning\n");
  });

  it("terminates the spawned process group on timeout", async () => {
    const root = await mkdtemp(join(tmpdir(), "deepseek-process-tree-"));
    const marker = join(root, "grandchild-survived.txt");
    const childScript = join(root, "child.mjs");
    await writeFile(
      childScript,
      [
        'import { spawn } from "node:child_process";',
        "const marker = process.argv[2];",
        "spawn(process.execPath, ['-e', `setTimeout(() => require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'survived'), 400)`], { stdio: 'ignore' });",
        "setInterval(() => {}, 1000);",
      ].join("\n"),
    );

    const result = await runCommand(process.execPath, [childScript, marker], {
      cwd: root,
      timeoutMs: 100,
    });
    await new Promise((resolve) => setTimeout(resolve, 600));

    assert.equal(result.timedOut, true);
    await assert.rejects(readFile(marker, "utf8"));
  });
});
