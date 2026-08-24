import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import { readBridgeVersion } from "../src/version.js";

describe("Bridge package version", () => {
  it("reads the source/build package manifest without duplicating the version", async () => {
    assert.equal(await readBridgeVersion(), "0.1.0-beta.1");
  });

  it("publishes both CLI names with an executable Node.js entrypoint", async () => {
    const manifest = JSON.parse(
      await readFile(resolve(process.cwd(), "package.json"), "utf8"),
    ) as { bin?: Record<string, string> };
    assert.deepEqual(manifest.bin, {
      "codex-dsh": "dist/src/cli.js",
      "deepseek-loop": "dist/src/cli.js",
    });

    const compiledCli = await readFile(
      resolve(process.cwd(), "dist/src/cli.js"),
      "utf8",
    );
    assert.ok(compiledCli.startsWith("#!/usr/bin/env node\n"));
  });
});
