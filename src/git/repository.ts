import { resolve } from "node:path";
import { runCommand } from "../lib/command.js";

export async function assertGitRepository(repository: string): Promise<string> {
  const absolute = resolve(repository);
  const result = await runCommand("git", ["rev-parse", "--show-toplevel"], {
    cwd: absolute,
    timeoutMs: 10_000,
  });
  if (result.exitCode !== 0) {
    throw new Error(`Not a Git repository: ${absolute}\n${result.stderr.trim()}`);
  }
  return result.stdout.trim();
}

export async function resolveCommit(repository: string, revision: string): Promise<string> {
  const result = await runCommand("git", ["rev-parse", "--verify", `${revision}^{commit}`], {
    cwd: repository,
    timeoutMs: 10_000,
  });
  if (result.exitCode !== 0) {
    throw new Error(`Cannot resolve base commit ${revision}: ${result.stderr.trim()}`);
  }
  return result.stdout.trim();
}

export async function listGitRefs(repository: string): Promise<Record<string, string>> {
  const result = await runCommand(
    "git",
    ["for-each-ref", "--format=%(refname)%00%(objectname)"],
    { cwd: repository, timeoutMs: 10_000 },
  );
  if (result.exitCode !== 0) {
    throw new Error(`Unable to inspect Git refs: ${result.stderr.trim()}`);
  }
  return Object.fromEntries(
    result.stdout
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [ref, object] = line.split("\0");
        if (!ref || !object) throw new Error(`Invalid Git ref record: ${line}`);
        return [ref, object];
      }),
  );
}

export async function listChangedFiles(worktree: string, baseCommit: string): Promise<string[]> {
  const tracked = await runCommand(
    "git",
    [
      "diff",
      "--name-only",
      "-z",
      "--find-renames",
      baseCommit,
      "--",
      ".",
      ":(exclude).deepseek-loop/**",
    ],
    { cwd: worktree, timeoutMs: 30_000 },
  );
  const untracked = await runCommand(
    "git",
    [
      "ls-files",
      "--others",
      "--exclude-standard",
      "-z",
      "--",
      ".",
      ":(exclude).deepseek-loop/**",
    ],
    { cwd: worktree, timeoutMs: 30_000 },
  );
  if (tracked.exitCode !== 0 || untracked.exitCode !== 0) {
    throw new Error(`Unable to inspect changed files:\n${tracked.stderr}${untracked.stderr}`);
  }

  return [...new Set(`${tracked.stdout}${untracked.stdout}`.split("\0").filter(Boolean))].sort();
}

export async function createPatch(worktree: string, baseCommit: string): Promise<string> {
  const tracked = await runCommand(
    "git",
    [
      "diff",
      "--binary",
      "--find-renames",
      baseCommit,
      "--",
      ".",
      ":(exclude).deepseek-loop/**",
    ],
    { cwd: worktree, timeoutMs: 60_000 },
  );
  if (tracked.exitCode !== 0) {
    throw new Error(`Unable to create patch: ${tracked.stderr.trim()}`);
  }

  const untracked = await runCommand(
    "git",
    [
      "ls-files",
      "--others",
      "--exclude-standard",
      "-z",
      "--",
      ".",
      ":(exclude).deepseek-loop/**",
    ],
    { cwd: worktree, timeoutMs: 30_000 },
  );
  if (untracked.exitCode !== 0) {
    throw new Error(`Unable to inspect untracked files: ${untracked.stderr.trim()}`);
  }

  let patch = tracked.stdout;
  for (const path of untracked.stdout.split("\0").filter(Boolean)) {
    const result = await runCommand(
      "git",
      ["diff", "--binary", "--no-index", "--", "/dev/null", path],
      { cwd: worktree, timeoutMs: 60_000 },
    );
    if (result.exitCode !== 0 && result.exitCode !== 1) {
      throw new Error(`Unable to include untracked file ${path}: ${result.stderr.trim()}`);
    }
    patch += result.stdout;
  }
  return patch;
}
