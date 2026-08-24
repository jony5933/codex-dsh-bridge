import { createHash } from "node:crypto";
import { access, chmod, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { delimiter, join } from "node:path";
import type { GitPolicyAudit } from "../types.js";
import { listGitRefs, resolveCommit } from "./repository.js";

export interface PreparedGitPolicy {
  audit: GitPolicyAudit;
  environment: NodeJS.ProcessEnv;
  startingRefs: Record<string, string>;
}

async function findExecutable(name: string): Promise<string> {
  for (const directory of (process.env.PATH ?? "").split(delimiter)) {
    if (!directory) continue;
    const candidate = join(directory, name);
    try {
      await access(candidate, constants.X_OK);
      return await realpath(candidate);
    } catch {
      // Try the next PATH entry.
    }
  }
  throw new Error(`Cannot locate executable in PATH: ${name}`);
}

function hash(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export async function prepareGitPolicy(
  artifactDirectory: string,
  worktree: string,
): Promise<PreparedGitPolicy> {
  const policyDirectory = join(artifactDirectory, "git-policy");
  const wrapperPath = join(policyDirectory, "git");
  const logPath = join(policyDirectory, "attempts.jsonl");
  const realGit = await findExecutable("git");
  const startingHead = await resolveCommit(worktree, "HEAD");
  const startingRefs = await listGitRefs(worktree);
  await mkdir(policyDirectory);
  await writeFile(logPath, "", "utf8");
  const wrapper = `#!${process.execPath}
const { appendFileSync } = require("node:fs");
const { spawnSync } = require("node:child_process");
const args = process.argv.slice(2);
const valueOptions = new Set(["-C", "-c", "--git-dir", "--work-tree"]);
let subcommand = "";
for (let index = 0; index < args.length; index += 1) {
  const argument = args[index];
  if (valueOptions.has(argument)) {
    index += 1;
    continue;
  }
  if (argument.startsWith("--git-dir=") || argument.startsWith("--work-tree=")) continue;
  if (!argument.startsWith("-")) {
    subcommand = argument;
    break;
  }
}
if (subcommand === "commit" || subcommand === "push") {
  appendFileSync(${JSON.stringify(logPath)}, JSON.stringify({ subcommand, args }) + "\\n");
  process.stderr.write("Runner Git policy denied: git " + subcommand + "\\n");
  process.exit(126);
}
const result = spawnSync(${JSON.stringify(realGit)}, args, {
  stdio: "inherit",
  env: { ...process.env, PATH: ${JSON.stringify(process.env.PATH ?? "")} },
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
`;
  await writeFile(wrapperPath, wrapper, "utf8");
  await chmod(wrapperPath, 0o755);
  return {
    audit: {
      wrapperPath,
      logPath,
      wrapperSha256: hash(wrapper),
      blockedCommands: [],
      startingHead,
      finalHead: startingHead,
      refChanges: [],
      verified: false,
      violations: [],
    },
    environment: {
      PATH: [policyDirectory, process.env.PATH].filter(Boolean).join(delimiter),
      GIT_TERMINAL_PROMPT: "0",
    },
    startingRefs,
  };
}

export async function verifyGitPolicy(
  prepared: PreparedGitPolicy,
  worktree: string,
): Promise<string[]> {
  const violations: string[] = [];
  const wrapper = await readFile(prepared.audit.wrapperPath, "utf8");
  if (hash(wrapper) !== prepared.audit.wrapperSha256) {
    violations.push("Git policy wrapper changed during Harness execution.");
  }
  const attemptText = await readFile(prepared.audit.logPath, "utf8");
  prepared.audit.blockedCommands = attemptText
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { subcommand: string; args: string[] });
  for (const attempt of prepared.audit.blockedCommands) {
    violations.push(`Denied Git command attempted: git ${attempt.subcommand}`);
  }

  prepared.audit.finalHead = await resolveCommit(worktree, "HEAD");
  if (prepared.audit.finalHead !== prepared.audit.startingHead) {
    violations.push(
      `Task branch HEAD changed from ${prepared.audit.startingHead} to ${prepared.audit.finalHead}.`,
    );
  }
  const finalRefs = await listGitRefs(worktree);
  const refNames = new Set([...Object.keys(prepared.startingRefs), ...Object.keys(finalRefs)]);
  prepared.audit.refChanges = [...refNames]
    .sort()
    .flatMap((ref) => {
      const before = prepared.startingRefs[ref] ?? null;
      const after = finalRefs[ref] ?? null;
      return before === after ? [] : [{ ref, before, after }];
    });
  for (const change of prepared.audit.refChanges) {
    violations.push(`Git ref changed during Harness execution: ${change.ref}`);
  }
  prepared.audit.verified = true;
  prepared.audit.violations = violations;
  return violations;
}
