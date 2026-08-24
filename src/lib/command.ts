import { spawn } from "node:child_process";
import type { CommandResult } from "../types.js";

export interface RunCommandOptions {
  cwd: string;
  timeoutMs?: number;
  stdin?: string;
  env?: NodeJS.ProcessEnv;
  onStdout?: ((chunk: string) => void) | undefined;
  onStderr?: ((chunk: string) => void) | undefined;
}

const CHECK_ENVIRONMENT_KEYS = new Set([
  "CI",
  "COLORTERM",
  "COREPACK_HOME",
  "FORCE_COLOR",
  "HOME",
  "LANG",
  "LOGNAME",
  "NO_COLOR",
  "NVM_BIN",
  "NVM_DIR",
  "NVM_INC",
  "PATH",
  "PNPM_HOME",
  "SHELL",
  "TEMP",
  "TERM",
  "TMP",
  "TMPDIR",
  "TZ",
  "USER",
  "XDG_CACHE_HOME",
  "XDG_CONFIG_HOME",
]);

export function createCheckEnvironment(
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue;
    if (CHECK_ENVIRONMENT_KEYS.has(key) || key.startsWith("LC_")) {
      environment[key] = value;
    }
  }
  return environment;
}

export async function runCommand(
  command: string,
  args: string[],
  options: RunCommandOptions,
): Promise<CommandResult> {
  const startedAt = Date.now();

  return await new Promise((resolve, reject) => {
    const ownsProcessGroup = process.platform !== "win32";
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      detached: ownsProcessGroup,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let timeout: NodeJS.Timeout | undefined;
    let forceKillTimeout: NodeJS.Timeout | undefined;

    const signalProcessTree = (signal: NodeJS.Signals): void => {
      if (ownsProcessGroup && child.pid !== undefined) {
        try {
          process.kill(-child.pid, signal);
          return;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
        }
      }
      child.kill(signal);
    };

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      options.onStdout?.(chunk);
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
      options.onStderr?.(chunk);
    });
    child.on("error", (error) => {
      if (timeout) clearTimeout(timeout);
      if (forceKillTimeout) clearTimeout(forceKillTimeout);
      reject(error);
    });
    child.on("close", (exitCode, signal) => {
      if (timeout) clearTimeout(timeout);
      if (forceKillTimeout) clearTimeout(forceKillTimeout);
      resolve({
        command,
        args,
        cwd: options.cwd,
        exitCode,
        signal,
        stdout,
        stderr,
        durationMs: Date.now() - startedAt,
        timedOut,
      });
    });

    if (options.stdin !== undefined) child.stdin.end(options.stdin);
    else child.stdin.end();

    if (options.timeoutMs) {
      timeout = setTimeout(() => {
        timedOut = true;
        signalProcessTree("SIGTERM");
        forceKillTimeout = setTimeout(() => signalProcessTree("SIGKILL"), 5000);
        forceKillTimeout.unref();
      }, options.timeoutMs);
      timeout.unref();
    }
  });
}

export async function runShellCheck(
  check: string,
  cwd: string,
  timeoutMs = 900_000,
): Promise<CommandResult> {
  return await runCommand("/bin/sh", ["-lc", check], {
    cwd,
    timeoutMs,
    env: createCheckEnvironment(),
  });
}
