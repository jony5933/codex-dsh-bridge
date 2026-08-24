import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const worktree = process.argv[2];
if (!worktree) throw new Error("Runner must pass the execution worktree as argv[2]");

assert.equal(
  await readFile(join(worktree, "src/skill-smoke-proof.txt"), "utf8"),
  "DSH_RUNNER_SKILL_PROOF_V1\n",
);
assert.equal(process.env.DSH_BUNDLED_SKILL_DIR, undefined);

process.stdout.write("Runner external Skill proof passed\n");
