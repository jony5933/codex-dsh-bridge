import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { describe, it } from "node:test";
import { runTask } from "../src/runner.js";

const execFileAsync = promisify(execFile);

async function git(cwd: string, ...args: string[]): Promise<string> {
  const result = await execFileAsync("git", args, { cwd });
  return result.stdout.trim();
}

async function findGitExecutable(): Promise<string> {
  const result = await execFileAsync("/bin/sh", ["-lc", "command -v git"]);
  return await realpath(result.stdout.trim());
}

async function createRepository(root: string): Promise<string> {
  const repository = join(root, "target");
  await mkdir(join(repository, "src"), { recursive: true });
  await writeFile(join(repository, "src", "original.txt"), "original\n");
  await git(repository, "init");
  await git(repository, "config", "user.email", "test@example.com");
  await git(repository, "config", "user.name", "Test User");
  await git(repository, "add", ".");
  await git(repository, "commit", "-m", "initial");
  return repository;
}

async function createContract(
  root: string,
  repository: string,
  fakeHarness: string,
  taskId: string,
  allowedPaths: string[],
  acceptanceChecks: Array<{
    id: string;
    runner: "node" | "shell";
    script: string;
  }> = [],
  skills?: {
    root?: string;
    names: string[];
    invocation?: "automatic" | "explicit";
  },
  requiredChecks = ["test -f src/result.txt"],
  forbiddenPaths = ["package.json"],
  baselineChecks: string[] = [],
): Promise<string> {
  const contractPath = join(root, `${taskId}.json`);
  await writeFile(
    contractPath,
    JSON.stringify({
      version: 1,
      taskId,
      repository,
      objective: "Write a deterministic file for an end-to-end runner test.",
      allowedPaths,
      forbiddenPaths,
      acceptanceCriteria: ["The requested file exists"],
      baselineChecks,
      requiredChecks,
      acceptanceChecks,
      skills,
      harness: {
        command: process.execPath,
        args:
          skills === undefined
            ? [fakeHarness, "{prompt}"]
            : [fakeHarness, "{skillPatch}", "{prompt}"],
        timeoutMs: 10_000,
      },
      execution: {
        worktreeRoot: join(root, "worktrees"),
        keepWorktree: true,
      },
    }),
  );
  return contractPath;
}

async function createRepairContract(root: string, parentContract: string): Promise<string> {
  const contractPath = join(root, "isolated-write-repair-1.json");
  await writeFile(
    contractPath,
    JSON.stringify({
      version: 1,
      taskId: "isolated-write-repair-1",
      repair: {
        parentContract,
        iteration: 1,
        findings: [
          {
            id: "missing-output",
            severity: "P2",
            title: "Create the expected output",
            description: "The previous implementation did not create the required output file.",
          },
        ],
      },
    }),
  );
  return contractPath;
}

describe("runTask", () => {
  it("keeps agent writes inside an isolated worktree", async () => {
    const root = await mkdtemp(join(tmpdir(), "deepseek-runner-"));
    const repository = await createRepository(root);
    const fakeHarness = join(root, "fake-harness.mjs");
    await writeFile(
      fakeHarness,
      'import { mkdirSync, writeFileSync } from "node:fs"; mkdirSync("src", { recursive: true }); writeFileSync("src/result.txt", "done\\n");\n',
    );
    const contractPath = await createContract(
      root,
      repository,
      fakeHarness,
      "isolated-write",
      ["src/**"],
    );

    const events: string[] = [];
    const harnessOutput: string[] = [];
    const report = await runTask(contractPath, {
      onEvent: (event) => events.push(event.phase),
      onHarnessStdout: (chunk) => harnessOutput.push(chunk),
    });

    assert.equal(report.status, "passed");
    assert.ok(report.skills);
    assert.ok(report.patchPath);
    assert.deepEqual(report.boundary.changedFiles, ["src/result.txt"]);
    assert.equal(await readFile(join(report.worktree, "src", "result.txt"), "utf8"), "done\n");
    await assert.rejects(readFile(join(repository, "src", "result.txt"), "utf8"));
    assert.match(report.branch, /^deepseek-loop\/isolated-write-/);
    const status = await git(report.worktree, "status", "--porcelain");
    assert.equal(status, "?? src/result.txt");
    assert.equal(report.reportPath.startsWith(report.worktree), false);
    assert.equal(report.skills.enabled, false);
    const patch = await readFile(report.patchPath, "utf8");
    assert.match(patch, /src\/result\.txt/);
    assert.doesNotMatch(patch, /\.deepseek-loop/);
    assert.deepEqual(events, [
      "preparing",
      "preparing",
      "harness",
      "harness",
      "checking",
      "checking",
      "verification",
      "complete",
    ]);
    assert.equal(harnessOutput.join(""), "");
  });

  it("fails the run when the executor crosses a path boundary", async () => {
    const root = await mkdtemp(join(tmpdir(), "deepseek-runner-"));
    const repository = await createRepository(root);
    const fakeHarness = join(root, "fake-harness.mjs");
    await writeFile(
      fakeHarness,
      'import { mkdirSync, writeFileSync } from "node:fs"; mkdirSync("src", { recursive: true }); writeFileSync("src/result.txt", "done\\n"); writeFileSync("package.json", "{}\\n");\n',
    );
    const contractPath = await createContract(
      root,
      repository,
      fakeHarness,
      "boundary-violation",
      ["src/**"],
    );

    const report = await runTask(contractPath);

    assert.equal(report.status, "failed");
    assert.deepEqual(report.boundary.violations, [
      { path: "package.json", reason: "explicitly-forbidden" },
    ]);
    assert.ok(report.failureReasons.includes("Path-boundary violations were detected."));
  });

  it("fails closed on an unexpected lockfile change even when the allowlist is broad", async () => {
    const root = await mkdtemp(join(tmpdir(), "deepseek-runner-"));
    const repository = await createRepository(root);
    const fakeHarness = join(root, "fake-lockfile-harness.mjs");
    await writeFile(
      fakeHarness,
      `import { mkdirSync, writeFileSync } from "node:fs";
mkdirSync("src", { recursive: true });
writeFileSync("src/result.txt", "done\\n");
writeFileSync("package-lock.json", '{"lockfileVersion":3}\\n');
`,
    );
    const contractPath = await createContract(
      root,
      repository,
      fakeHarness,
      "unexpected-lockfile",
      ["**"],
      [],
      undefined,
      ["test -f src/result.txt"],
      ["package.json", "package-lock.json", "pnpm-lock.yaml", "yarn.lock"],
    );

    const report = await runTask(contractPath);

    assert.ok(report.harness);
    assert.ok(report.patchPath);
    assert.equal(report.harness.exitCode, 0);
    assert.equal(report.checks[0]?.exitCode, 0);
    assert.equal(report.status, "failed");
    assert.deepEqual(report.boundary.allowedFiles, ["src/result.txt"]);
    assert.deepEqual(report.boundary.violations, [
      { path: "package-lock.json", reason: "explicitly-forbidden" },
    ]);
    assert.ok(report.failureReasons.includes("Path-boundary violations were detected."));
    assert.match(await readFile(report.patchPath, "utf8"), /package-lock\.json/);
    await assert.rejects(readFile(join(repository, "package-lock.json"), "utf8"));

    const persisted = JSON.parse(await readFile(report.reportPath, "utf8")) as {
      status: string;
      boundary: typeof report.boundary;
      failureReasons: string[];
    };
    assert.equal(persisted.status, "failed");
    assert.deepEqual(persisted.boundary, report.boundary);
    assert.deepEqual(persisted.failureReasons, report.failureReasons);
  });

  it("rejects conflicting acceptance identities before starting the Harness", async () => {
    const root = await mkdtemp(join(tmpdir(), "deepseek-runner-"));
    const repository = await createRepository(root);
    const harnessMarker = join(root, "harness-started.txt");
    const fakeHarness = join(root, "fake-conflict-harness.mjs");
    await writeFile(
      fakeHarness,
      `import { writeFileSync } from "node:fs";
writeFileSync(${JSON.stringify(harnessMarker)}, "started\\n");
`,
    );
    const contractPath = await createContract(
      root,
      repository,
      fakeHarness,
      "conflicting-acceptance",
      ["src/**"],
      [
        {
          id: "stable-behavior",
          runner: "node",
          script: "./expect-enabled.mjs",
        },
        {
          id: "stable-behavior",
          runner: "node",
          script: "./expect-disabled.mjs",
        },
      ],
    );

    await assert.rejects(
      runTask(contractPath),
      /duplicate id "stable-behavior" makes check identity ambiguous/,
    );
    await assert.rejects(readFile(harnessMarker, "utf8"));
    await assert.rejects(readFile(join(repository, "src", "result.txt"), "utf8"));
  });

  it("blocks a pre-existing baseline failure before starting the Harness", async () => {
    const root = await mkdtemp(join(tmpdir(), "deepseek-runner-"));
    const repository = await createRepository(root);
    const harnessMarker = join(root, "baseline-harness-started.txt");
    const fakeHarness = join(root, "fake-baseline-harness.mjs");
    await writeFile(
      fakeHarness,
      `import { writeFileSync } from "node:fs";
writeFileSync(${JSON.stringify(harnessMarker)}, "started\\n");
`,
    );
    const contractPath = await createContract(
      root,
      repository,
      fakeHarness,
      "pre-existing-failure",
      ["src/**"],
      [],
      undefined,
      ["test -f src/result.txt"],
      ["package.json"],
      ["test -f src/baseline-healthy.txt"],
    );
    const events: string[] = [];

    const report = await runTask(contractPath, {
      onEvent: (event) => events.push(event.phase),
    });

    assert.equal(report.version, 1);
    assert.equal(report.status, "blocked");
    assert.deepEqual(report.blockers, ["Baseline checks failed before Harness execution."]);
    assert.deepEqual(report.failureReasons, []);
    assert.equal(report.harness, null);
    assert.equal(report.skills, null);
    assert.equal(report.gitPolicy, null);
    assert.equal(report.patchPath, null);
    assert.deepEqual(report.checks, []);
    assert.deepEqual(report.acceptanceChecks, []);
    assert.deepEqual(report.boundary, { changedFiles: [], allowedFiles: [], violations: [] });
    await assert.rejects(readFile(harnessMarker, "utf8"));
    await assert.rejects(readFile(join(repository, "src", "result.txt"), "utf8"));
    assert.equal(report.baselineChecks[0]?.check, "test -f src/baseline-healthy.txt");
    assert.equal(report.baselineChecks[0]?.exitCode, 1);
    assert.deepEqual(JSON.parse(await readFile(report.reportPath, "utf8")), report);
    await assert.rejects(readFile(join(dirname(report.reportPath), "preflight.json"), "utf8"));
    assert.deepEqual(events, ["preparing", "preparing", "checking", "checking", "complete"]);
  });

  it("denies and audits git commit and push attempts through the Harness PATH", async () => {
    const root = await mkdtemp(join(tmpdir(), "deepseek-runner-"));
    const repository = await createRepository(root);
    const baseCommit = await git(repository, "rev-parse", "HEAD");
    const fakeHarness = join(root, "fake-git-attempt-harness.mjs");
    await writeFile(
      fakeHarness,
      `import { mkdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
mkdirSync("src", { recursive: true });
writeFileSync("src/result.txt", "done\\n");
if (spawnSync("git", ["add", "src/result.txt"]).status !== 0) process.exit(7);
if (spawnSync("git", ["commit", "-m", "forbidden commit"]).status !== 126) process.exit(8);
if (spawnSync("git", ["push", "origin", "HEAD"]).status !== 126) process.exit(9);
`,
    );
    const contractPath = await createContract(
      root,
      repository,
      fakeHarness,
      "git-command-attempts",
      ["src/**"],
    );

    const report = await runTask(contractPath);

    assert.ok(report.harness);
    assert.equal(report.harness.exitCode, 0);
    assert.equal(report.checks[0]?.exitCode, 0);
    assert.equal(report.status, "failed");
    assert.equal(report.gitPolicy?.verified, true);
    assert.deepEqual(
      report.gitPolicy?.blockedCommands.map((attempt) => attempt.subcommand),
      ["commit", "push"],
    );
    assert.equal(report.gitPolicy?.startingHead, baseCommit);
    assert.equal(report.gitPolicy?.finalHead, baseCommit);
    assert.deepEqual(report.gitPolicy?.refChanges, []);
    assert.match(report.gitPolicy?.violations.join("\n") ?? "", /git commit/);
    assert.match(report.gitPolicy?.violations.join("\n") ?? "", /git push/);
    assert.ok(report.failureReasons.includes("Git policy violations were detected."));
    assert.equal(await git(repository, "rev-parse", "HEAD"), baseCommit);
  });

  it("detects task branch history changes that bypass the Git wrapper", async () => {
    const root = await mkdtemp(join(tmpdir(), "deepseek-runner-"));
    const repository = await createRepository(root);
    const baseCommit = await git(repository, "rev-parse", "HEAD");
    const realGit = await findGitExecutable();
    const fakeHarness = join(root, "fake-git-bypass-harness.mjs");
    await writeFile(
      fakeHarness,
      `import { mkdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
mkdirSync("src", { recursive: true });
writeFileSync("src/result.txt", "committed\\n");
if (spawnSync(${JSON.stringify(realGit)}, ["add", "src/result.txt"]).status !== 0) process.exit(7);
if (spawnSync(${JSON.stringify(realGit)}, ["commit", "-m", "bypass wrapper"]).status !== 0) process.exit(8);
`,
    );
    const contractPath = await createContract(
      root,
      repository,
      fakeHarness,
      "git-wrapper-bypass",
      ["src/**"],
    );

    const report = await runTask(contractPath);

    assert.ok(report.harness);
    assert.equal(report.harness.exitCode, 0);
    assert.equal(report.checks[0]?.exitCode, 0);
    assert.equal(report.status, "failed");
    assert.deepEqual(report.gitPolicy?.blockedCommands, []);
    assert.equal(report.gitPolicy?.startingHead, baseCommit);
    assert.notEqual(report.gitPolicy?.finalHead, baseCommit);
    assert.ok(
      report.gitPolicy?.refChanges.some((change) => change.ref === `refs/heads/${report.branch}`),
    );
    assert.match(report.gitPolicy?.violations.join("\n") ?? "", /Task branch HEAD changed/);
    assert.match(report.gitPolicy?.violations.join("\n") ?? "", /Git ref changed/);
    assert.ok(report.failureReasons.includes("Git policy violations were detected."));
    assert.equal(await git(repository, "rev-parse", "HEAD"), baseCommit);
  });

  it("records repair lineage in the report and inherited prompt", async () => {
    const root = await mkdtemp(join(tmpdir(), "deepseek-runner-"));
    const repository = await createRepository(root);
    const fakeHarness = join(root, "fake-harness.mjs");
    await writeFile(
      fakeHarness,
      'import { mkdirSync, writeFileSync } from "node:fs"; mkdirSync("src", { recursive: true }); writeFileSync("src/result.txt", "repaired\\n");\n',
    );
    const acceptanceScript = join(root, "verify-result.mjs");
    await writeFile(
      acceptanceScript,
      'import { readFile } from "node:fs/promises"; import { join } from "node:path"; const value = await readFile(join(process.argv[2], "src", "result.txt"), "utf8"); if (value !== "repaired\\n") process.exit(1);\n',
    );
    const baseContract = await createContract(
      root,
      repository,
      fakeHarness,
      "isolated-write-base",
      ["src/**"],
      [
        {
          id: "verify-original-result",
          runner: "node",
          script: "./verify-result.mjs",
        },
      ],
    );
    const repairContract = await createRepairContract(root, baseContract);

    const report = await runTask(repairContract);

    assert.equal(report.status, "passed");
    assert.equal(report.lineage.iteration, 1);
    assert.equal(report.lineage.parentContractPath, baseContract);
    assert.equal(report.lineage.rootContractPath, baseContract);
    assert.equal(report.lineage.findings[0]?.id, "missing-output");
    assert.equal(report.lineage.history[0]?.findings[0]?.id, "missing-output");
    assert.equal(report.acceptanceChecks.length, 1);
    assert.equal(report.acceptanceChecks[0]?.id, "verify-original-result");
    assert.equal(report.acceptanceChecks[0]?.exitCode, 0);
    const prompt = await readFile(join(report.reportPath, "..", "prompt.md"), "utf8");
    assert.match(prompt, /missing-output/);
    assert.match(prompt, /The requested file exists/);
    assert.doesNotMatch(prompt, /verify-result\.mjs/);
  });

  it("fails when an independent acceptance check detects behavior drift", async () => {
    const root = await mkdtemp(join(tmpdir(), "deepseek-runner-"));
    const repository = await createRepository(root);
    const fakeHarness = join(root, "fake-harness.mjs");
    await writeFile(
      fakeHarness,
      'import { mkdirSync, writeFileSync } from "node:fs"; mkdirSync("src", { recursive: true }); writeFileSync("src/result.txt", "drifted\\n");\n',
    );
    const acceptanceScript = join(root, "verify-stable-result.mjs");
    await writeFile(
      acceptanceScript,
      'import { readFile } from "node:fs/promises"; import { join } from "node:path"; const value = await readFile(join(process.argv[2], "src", "result.txt"), "utf8"); if (value !== "stable\\n") { console.error("response drifted"); process.exit(1); }\n',
    );
    const contractPath = await createContract(
      root,
      repository,
      fakeHarness,
      "acceptance-drift",
      ["src/**"],
      [
        {
          id: "verify-stable-result",
          runner: "node",
          script: "./verify-stable-result.mjs",
        },
      ],
    );

    const report = await runTask(contractPath);

    assert.equal(report.checks[0]?.exitCode, 0);
    assert.equal(report.acceptanceChecks[0]?.exitCode, 1);
    assert.equal(report.status, "failed");
    assert.ok(
      report.failureReasons.includes("One or more independent acceptance checks failed."),
    );
  });

  it("rejects acceptance scripts stored inside the target repository", async () => {
    const root = await mkdtemp(join(tmpdir(), "deepseek-runner-"));
    const repository = await createRepository(root);
    const fakeHarness = join(root, "fake-harness.mjs");
    await writeFile(fakeHarness, "process.exit(0);\n");
    const repositoryCheck = join(repository, "verify-result.mjs");
    await writeFile(repositoryCheck, "process.exit(0);\n");
    const contractPath = await createContract(
      root,
      repository,
      fakeHarness,
      "acceptance-inside-repository",
      ["src/**"],
      [
        {
          id: "invalid-location",
          runner: "node",
          script: "./target/verify-result.mjs",
        },
      ],
    );

    await assert.rejects(
      runTask(contractPath),
      /must be stored outside the target repository/,
    );
  });

  it("stages only declared external Skills for the Harness and records their hashes", async () => {
    const root = await mkdtemp(join(tmpdir(), "deepseek-runner-"));
    const repository = await createRepository(root);
    const skillRoot = join(root, "external-skills");
    const selectedBundle = join(skillRoot, "selected-skill");
    const extraBundle = join(skillRoot, "extra-skill");
    await mkdir(join(selectedBundle, "references"), { recursive: true });
    await mkdir(extraBundle, { recursive: true });
    await writeFile(
      join(selectedBundle, "SKILL.md"),
      '---\nname: selected-skill\ndescription: "只用于 Runner 自动测试。"\n---\n\n遵循测试指令。\n',
    );
    await writeFile(join(selectedBundle, "references", "rule.md"), "stable rule\n");
    await writeFile(
      join(extraBundle, "SKILL.md"),
      "---\nname: extra-skill\ndescription: 不应进入投影。\n---\n",
    );

    const fakeHarness = join(root, "fake-skill-harness.mjs");
    await writeFile(
      fakeHarness,
      `import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const root = process.env.DSH_BUNDLED_SKILL_DIR;
if (!root) throw new Error("missing DSH_BUNDLED_SKILL_DIR");
if (existsSync(join(root, "extra-skill"))) throw new Error("undeclared Skill was staged");
const skill = readFileSync(join(root, "selected-skill", "SKILL.md"), "utf8");
if (!skill.includes("name: selected-skill")) throw new Error("selected Skill missing");
if (!process.argv[3].includes("/selected-skill")) throw new Error("explicit invocation missing");
mkdirSync("src", { recursive: true });
writeFileSync("src/result.txt", "skill-loaded\\n");
`,
    );
    const contractPath = await createContract(
      root,
      repository,
      fakeHarness,
      "external-skill",
      ["src/**"],
      [],
      {
        root: "./external-skills",
        names: ["selected-skill"],
        invocation: "explicit",
      },
      ['test -f src/result.txt && test -z "${DSH_BUNDLED_SKILL_DIR:-}"'],
    );

    const report = await runTask(contractPath);

    assert.equal(report.status, "passed");
    assert.ok(report.skills);
    assert.equal(report.skills.enabled, true);
    assert.equal(report.skills.isolated, true);
    assert.equal(report.skills.invocation, "explicit");
    assert.equal(report.skills.sourceRoot, await realpath(skillRoot));
    assert.equal(report.skills.stagedRoot?.startsWith(report.worktree), false);
    assert.equal(report.skills.patchPath?.startsWith(report.worktree), false);
    assert.match(report.skills.patchSha256 ?? "", /^[a-f0-9]{64}$/);
    assert.equal(report.skills.verified, true);
    assert.deepEqual(report.skills.violations, []);
    assert.deepEqual(report.skills.bundles.map((bundle) => bundle.name), ["selected-skill"]);
    assert.match(report.skills.bundles[0]?.sha256 ?? "", /^[a-f0-9]{64}$/);
    assert.equal(report.skills.bundles[0]?.fileCount, 2);
    await assert.rejects(readFile(join(report.skills.stagedRoot ?? "", "extra-skill", "SKILL.md")));
    assert.match(
      await readFile(join(report.skills.stagedRoot ?? "", "selected-skill", "SKILL.md"), "utf8"),
      /selected-skill/,
    );
    const persisted = JSON.parse(await readFile(report.reportPath, "utf8")) as {
      skills: typeof report.skills;
    };
    assert.deepEqual(persisted.skills, report.skills);
  });

  it("isolates an explicitly empty Skill catalog for no-Skill experiments", async () => {
    const root = await mkdtemp(join(tmpdir(), "deepseek-runner-"));
    const repository = await createRepository(root);
    const fakeHarness = join(root, "fake-empty-skill-harness.mjs");
    await writeFile(
      fakeHarness,
      `import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
const patch = readFileSync(process.argv[2], "utf8");
if (!patch.includes("includeDefaultRoots: false")) throw new Error("default Skill roots not disabled");
if (!process.env.DSH_BUNDLED_SKILL_DIR) throw new Error("isolated staged root missing");
mkdirSync("src", { recursive: true });
writeFileSync("src/result.txt", "no-skill\\n");
`,
    );
    const contractPath = await createContract(
      root,
      repository,
      fakeHarness,
      "empty-skill-catalog",
      ["src/**"],
      [],
      { names: [] },
      ['test -f src/result.txt && test -z "${DSH_BUNDLED_SKILL_DIR:-}"'],
    );

    const report = await runTask(contractPath);

    assert.equal(report.status, "passed");
    assert.ok(report.skills);
    assert.equal(report.skills.isolated, true);
    assert.equal(report.skills.enabled, false);
    assert.equal(report.skills.sourceRoot, null);
    assert.deepEqual(report.skills.bundles, []);
    assert.equal(typeof report.skills.patchPath, "string");
    assert.equal(report.skills.verified, true);
  });

  it("rejects Skill roots inside the target repository", async () => {
    const root = await mkdtemp(join(tmpdir(), "deepseek-runner-"));
    const repository = await createRepository(root);
    const skillBundle = join(repository, "skills", "unsafe-skill");
    await mkdir(skillBundle, { recursive: true });
    await writeFile(
      join(skillBundle, "SKILL.md"),
      "---\nname: unsafe-skill\ndescription: 不能来自目标仓库。\n---\n",
    );
    const fakeHarness = join(root, "fake-harness.mjs");
    await writeFile(fakeHarness, 'throw new Error("Harness must not start");\n');
    const contractPath = await createContract(
      root,
      repository,
      fakeHarness,
      "skill-inside-repository",
      ["src/**"],
      [],
      { root: "./target/skills", names: ["unsafe-skill"] },
    );

    await assert.rejects(runTask(contractPath), /must be stored outside the target repository/);
  });

  it("rejects symbolic links inside external Skill bundles", async () => {
    const root = await mkdtemp(join(tmpdir(), "deepseek-runner-"));
    const repository = await createRepository(root);
    const skillBundle = join(root, "external-skills", "linked-skill");
    await mkdir(skillBundle, { recursive: true });
    await writeFile(
      join(skillBundle, "SKILL.md"),
      "---\nname: linked-skill\ndescription: 包含不安全链接。\n---\n",
    );
    await writeFile(join(root, "outside.md"), "outside\n");
    await symlink(join(root, "outside.md"), join(skillBundle, "reference.md"));
    const fakeHarness = join(root, "fake-harness.mjs");
    await writeFile(fakeHarness, 'throw new Error("Harness must not start");\n');
    const contractPath = await createContract(
      root,
      repository,
      fakeHarness,
      "skill-symlink",
      ["src/**"],
      [],
      { root: "./external-skills", names: ["linked-skill"] },
    );

    await assert.rejects(runTask(contractPath), /cannot contain symbolic links/);
  });

  it("fails when the Harness tampers with the staged Skill projection", async () => {
    const root = await mkdtemp(join(tmpdir(), "deepseek-runner-"));
    const repository = await createRepository(root);
    const skillBundle = join(root, "external-skills", "tamper-skill");
    await mkdir(skillBundle, { recursive: true });
    await writeFile(
      join(skillBundle, "SKILL.md"),
      "---\nname: tamper-skill\ndescription: 验证投影完整性。\n---\n",
    );
    const fakeHarness = join(root, "fake-tamper-harness.mjs");
    await writeFile(
      fakeHarness,
      `import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
writeFileSync(join(process.env.DSH_BUNDLED_SKILL_DIR, "tamper-skill", "SKILL.md"), "tampered\\n");
mkdirSync("src", { recursive: true });
writeFileSync("src/result.txt", "done\\n");
`,
    );
    const contractPath = await createContract(
      root,
      repository,
      fakeHarness,
      "skill-projection-tamper",
      ["src/**"],
      [],
      { root: "./external-skills", names: ["tamper-skill"], invocation: "explicit" },
    );

    const report = await runTask(contractPath);

    assert.equal(report.checks[0]?.exitCode, 0);
    assert.ok(report.skills);
    assert.equal(report.skills.verified, false);
    assert.match(report.skills.violations.join("\n"), /bundle changed/);
    assert.equal(report.status, "failed");
    assert.ok(
      report.failureReasons.includes("Skill projection integrity violations were detected."),
    );
  });
});
