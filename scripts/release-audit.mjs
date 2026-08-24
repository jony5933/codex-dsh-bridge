import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync } from "node:fs";
import { basename } from "node:path";

const candidates = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  { encoding: "utf8" },
)
  .split("\0")
  .filter(Boolean);

const forbiddenTrees = ["docs/evidence/", "contracts/runs/"];
const contentRules = [
  {
    id: "local-user-path",
    pattern: /\/Users\/cys7\//g,
    message: "包含维护者本机用户路径",
  },
  {
    id: "local-temporary-path",
    pattern: /\/private\/tmp\//g,
    message: "包含维护者本机临时路径",
  },
  {
    id: "private-key",
    pattern: /BEGIN (?:RSA |OPENSSH |EC |DSA )?PRIVATE KEY/g,
    message: "包含 private-key header",
  },
  {
    id: "common-token",
    pattern: /(?:sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16})/g,
    message: "包含常见 secret/token 形式",
  },
];

const findings = [];
for (const path of candidates) {
  let stats;
  try {
    stats = lstatSync(path);
  } catch {
    // `git ls-files --cached` also returns tracked paths deleted from the
    // release snapshot. They are intentionally absent and need no content scan.
    continue;
  }
  if (stats.isSymbolicLink()) {
    findings.push({
      id: "symbolic-link",
      path,
      message: "公开 release snapshot 禁止 symlink",
    });
    continue;
  }
  if (!stats.isFile()) continue;
  if (forbiddenTrees.some((prefix) => path.startsWith(prefix))) {
    findings.push({
      id: "private-release-tree",
      path,
      message: "原始 evidence 或本机运行 Contract 不得进入公开 release snapshot",
    });
    continue;
  }
  if (basename(path) === ".env" || basename(path).startsWith(".env.")) {
    findings.push({ id: "environment-file", path, message: "不得发布 .env 文件" });
    continue;
  }
  if (stats.size > 5_000_000) continue;
  const buffer = readFileSync(path);
  if (buffer.includes(0)) continue;
  const content = buffer.toString("utf8");
  for (const rule of contentRules) {
    rule.pattern.lastIndex = 0;
    if (rule.pattern.test(content)) {
      findings.push({ id: rule.id, path, message: rule.message });
    }
  }
}

const result = {
  version: 1,
  status: findings.length === 0 ? "passed" : "failed",
  scannedFiles: candidates.length,
  findings,
};
console.log(JSON.stringify(result, null, 2));
if (findings.length > 0) process.exitCode = 1;
