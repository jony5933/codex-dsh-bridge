import { mkdir } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { runCommand } from "../lib/command.js";

export interface WorktreeInfo {
  path: string;
  branch: string;
}

export async function createWorktree(
  repository: string,
  baseCommit: string,
  runId: string,
  configuredRoot?: string,
): Promise<WorktreeInfo> {
  const root = configuredRoot
    ? resolve(configuredRoot)
    : join(tmpdir(), "codex-deepseek-loop", basename(repository));
  const path = join(root, runId);
  const branch = `deepseek-loop/${runId}`;
  await mkdir(dirname(path), { recursive: true });

  const result = await runCommand(
    "git",
    ["worktree", "add", "--detach", path, baseCommit],
    { cwd: repository, timeoutMs: 60_000 },
  );
  if (result.exitCode !== 0) {
    throw new Error(`Unable to create worktree: ${result.stderr.trim()}`);
  }

  const branchResult = await runCommand("git", ["switch", "-c", branch], {
    cwd: path,
    timeoutMs: 30_000,
  });
  if (branchResult.exitCode !== 0) {
    throw new Error(`Unable to create task branch: ${branchResult.stderr.trim()}`);
  }

  return { path, branch };
}
