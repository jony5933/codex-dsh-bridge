import { access, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runCommand } from "../lib/command.js";
import type { CommandResult, TaskContract } from "../types.js";
import type {
  HarnessExecutionRequest,
  HarnessTransport,
  HarnessTransportOutput,
} from "./transport.js";

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
async function findProtocolPath(): Promise<string> {
  const candidates = [
    resolve(moduleDirectory, "../../prompts/executor.md"),
    resolve(moduleDirectory, "../../../prompts/executor.md"),
  ];
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next source/build layout.
    }
  }
  throw new Error("Cannot locate prompts/executor.md");
}

export async function buildExecutionPrompt(
  contract: TaskContract,
  baseCommit: string,
): Promise<string> {
  const protocol = await readFile(await findProtocolPath(), "utf8");
  const contractForAgent = {
    taskId: contract.taskId,
    objective: contract.objective,
    baseCommit,
    allowedPaths: contract.allowedPaths,
    forbiddenPaths: contract.forbiddenPaths,
    acceptanceCriteria: contract.acceptanceCriteria,
    baselineChecks: contract.baselineChecks,
    requiredChecks: contract.requiredChecks,
    instructions: contract.instructions,
    lineage: {
      iteration: contract.lineage.iteration,
      findings: contract.lineage.findings,
      history: contract.lineage.history,
    },
  };
  const skillInvocation =
    contract.skills?.invocation === "explicit"
      ? `\n\n# DSH Skills\n\n在执行任何任务操作前，加载并遵循以下 DSH 原生 Skill：\n\n${contract.skills.names.map((name) => `/${name}`).join("\n")}\n`
      : "";
  return `${protocol}${skillInvocation}\n\n# Task contract\n\n\`\`\`json\n${JSON.stringify(contractForAgent, null, 2)}\n\`\`\`\n`;
}

export class HeadlessTransport implements HarnessTransport {
  readonly kind = "headless";

  async execute(request: HarnessExecutionRequest): Promise<CommandResult> {
    return await runHeadlessHarness(
      request.contract,
      request.worktree,
      request.prompt,
      request.skillPatch,
      request.output,
    );
  }
}

async function runHeadlessHarness(
  contract: TaskContract,
  worktree: string,
  prompt: string,
  skillPatch: string | undefined,
  output: HarnessTransportOutput = {},
): Promise<CommandResult> {
  const args = contract.harness.args.map((argument) =>
    argument
      .replaceAll("{prompt}", prompt)
      .replaceAll("{worktree}", worktree)
      .replaceAll("{skillPatch}", skillPatch ?? ""),
  );
  const { env, ...callbacks } = output;
  return await runCommand(contract.harness.command, args, {
    cwd: worktree,
    timeoutMs: contract.harness.timeoutMs,
    ...(env === undefined ? {} : { env }),
    ...callbacks,
  });
}
