import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const moduleDirectory = dirname(fileURLToPath(import.meta.url));

export async function readBridgeVersion(): Promise<string> {
  const candidates = [
    resolve(moduleDirectory, "../package.json"),
    resolve(moduleDirectory, "../../package.json"),
  ];
  for (const candidate of candidates) {
    try {
      const packageDocument = JSON.parse(await readFile(candidate, "utf8")) as unknown;
      if (
        typeof packageDocument === "object" &&
        packageDocument !== null &&
        "name" in packageDocument &&
        packageDocument.name === "codex-dsh-bridge" &&
        "version" in packageDocument &&
        typeof packageDocument.version === "string"
      ) {
        return packageDocument.version;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  throw new Error("Cannot locate the codex-dsh-bridge package manifest.");
}
