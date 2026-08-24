import type { CommandResult, TaskContract } from "../types.js";

export interface HarnessTransportOutput {
  env?: NodeJS.ProcessEnv | undefined;
  onStdout?: ((chunk: string) => void) | undefined;
  onStderr?: ((chunk: string) => void) | undefined;
}

export interface HarnessExecutionRequest {
  contract: TaskContract;
  worktree: string;
  prompt: string;
  skillPatch: string | undefined;
  output: HarnessTransportOutput;
}

export interface HarnessTransport {
  readonly kind: string;
  execute(request: HarnessExecutionRequest): Promise<CommandResult>;
}
