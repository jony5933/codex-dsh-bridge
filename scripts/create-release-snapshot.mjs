import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  statSync,
} from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";

const rawArguments = process.argv.slice(2);
const targetArgument = rawArguments[0] === "--" ? rawArguments[1] : rawArguments[0];
if (!targetArgument) {
  throw new Error("Usage: node scripts/create-release-snapshot.mjs <new-target-directory>");
}

const repository = realpathSync(process.cwd());
const target = resolve(targetArgument);
const targetFromRepository = relative(repository, target);
if (
  targetFromRepository === "" ||
  (!targetFromRepository.startsWith("..") && !isAbsolute(targetFromRepository))
) {
  throw new Error("Release snapshot target must be outside the development repository.");
}

try {
  statSync(target);
  throw new Error("Release snapshot target already exists; refusing to overwrite it.");
} catch (error) {
  if (error instanceof Error && error.message.includes("refusing to overwrite")) throw error;
  if (error?.code !== "ENOENT") throw error;
}

execFileSync(process.execPath, ["scripts/release-audit.mjs"], {
  cwd: repository,
  stdio: "inherit",
});

const candidates = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  { cwd: repository, encoding: "utf8" },
)
  .split("\0")
  .filter(Boolean)
  .filter((path) => {
    try {
      const stats = lstatSync(resolve(repository, path));
      return stats.isFile() && !stats.isSymbolicLink();
    } catch {
      return false;
    }
  })
  .sort();

mkdirSync(target, { recursive: false, mode: 0o755 });
const files = [];
for (const path of candidates) {
  const source = resolve(repository, path);
  const destination = resolve(target, path);
  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(source, destination);
  const buffer = readFileSync(source);
  files.push({
    path,
    bytes: buffer.byteLength,
    sha256: createHash("sha256").update(buffer).digest("hex"),
  });
}

console.log(
  JSON.stringify(
    {
      version: 1,
      status: "created",
      target,
      fileCount: files.length,
      snapshotSha256: createHash("sha256")
        .update(JSON.stringify(files))
        .digest("hex"),
    },
    null,
    2,
  ),
);
