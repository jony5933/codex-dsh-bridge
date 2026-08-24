import { realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { createCheckEnvironment, runCommand } from "./lib/command.js";
import type {
  AcceptanceCheckConfig,
  AcceptanceCheckResult,
  ContractLineage,
} from "./types.js";

interface PreparedAcceptanceCheck {
  config: AcceptanceCheckConfig;
  script: string;
}

function isInside(parent: string, candidate: string): boolean {
  const pathFromParent = relative(parent, candidate);
  return (
    pathFromParent === "" ||
    (!pathFromParent.startsWith("..") && !isAbsolute(pathFromParent))
  );
}

export async function prepareAcceptanceChecks(
  checks: AcceptanceCheckConfig[],
  lineage: ContractLineage,
  repository: string,
  worktree: string,
): Promise<PreparedAcceptanceCheck[]> {
  const repositoryPath = await realpath(repository);
  const worktreePath = await realpath(worktree);
  const rootContractDirectory = dirname(lineage.rootContractPath);

  return await Promise.all(
    checks.map(async (config) => {
      const script = await realpath(resolve(rootContractDirectory, config.script));
      if (isInside(repositoryPath, script)) {
        throw new Error(
          `Acceptance check ${config.id} must be stored outside the target repository: ${script}`,
        );
      }
      if (isInside(worktreePath, script)) {
        throw new Error(
          `Acceptance check ${config.id} must be stored outside the execution worktree: ${script}`,
        );
      }
      return { config, script };
    }),
  );
}

export async function runAcceptanceCheck(
  prepared: PreparedAcceptanceCheck,
  worktree: string,
): Promise<AcceptanceCheckResult> {
  const command = prepared.config.runner === "node" ? process.execPath : "/bin/sh";
  const args = [prepared.script, worktree, ...prepared.config.args];
  const result = await runCommand(command, args, {
    cwd: dirname(prepared.script),
    timeoutMs: prepared.config.timeoutMs,
    env: createCheckEnvironment(),
  });
  return {
    ...result,
    id: prepared.config.id,
    script: prepared.script,
  };
}
