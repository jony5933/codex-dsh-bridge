import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { loadContract } from "../src/contract.js";

async function writeBaseContract(directory: string): Promise<string> {
  const path = join(directory, "base.json");
  await writeFile(
    path,
    JSON.stringify({
      version: 1,
      taskId: "base-task",
      repository: "./target",
      baseCommit: "abc123",
      objective: "Implement one stable and testable behavior.",
      allowedPaths: ["src/**"],
      forbiddenPaths: ["package.json"],
      acceptanceCriteria: ["The original response shape remains stable"],
      requiredChecks: ["npm test"],
      acceptanceChecks: [
        {
          id: "original-response-shape",
          runner: "node",
          script: "./checks/original-response-shape.mjs",
        },
      ],
      skills: {
        root: "./skills",
        names: ["stable-contract"],
      },
      harness: {
        args: ["--profile", "headless", "--patch", "{skillPatch}", "{prompt}"],
      },
      instructions: "保持原始响应结构。",
    }),
  );
  return path;
}

describe("loadContract", () => {
  it("applies safe defaults", async () => {
    const directory = await mkdtemp(join(tmpdir(), "deepseek-contract-"));
    const path = join(directory, "task.json");
    await writeFile(
      path,
      JSON.stringify({
        version: 1,
        taskId: "test-task",
        repository: ".",
        objective: "Make a focused and testable change.",
        allowedPaths: ["src/**"],
        acceptanceCriteria: ["Tests pass"],
        requiredChecks: [],
      }),
    );
    const contract = await loadContract(path);
    assert.equal(contract.baseCommit, "HEAD");
    assert.equal(contract.harness.command, "dsh");
    assert.equal(contract.execution.keepWorktree, true);
    assert.deepEqual(contract.baselineChecks, []);
    assert.deepEqual(contract.acceptanceChecks, []);
    assert.equal(contract.skills, undefined);
    assert.equal(contract.lineage.iteration, 0);
    assert.equal(contract.lineage.contractPath, path);
    assert.equal(contract.lineage.rootContractPath, path);
    assert.deepEqual(contract.lineage.findings, []);
    assert.deepEqual(contract.lineage.history, []);
  });

  it("rejects a contract without path boundaries", async () => {
    const directory = await mkdtemp(join(tmpdir(), "deepseek-contract-"));
    const path = join(directory, "task.json");
    await writeFile(
      path,
      JSON.stringify({
        version: 1,
        taskId: "test-task",
        repository: ".",
        objective: "Make a focused and testable change.",
        acceptanceCriteria: ["Tests pass"],
        requiredChecks: [],
      }),
    );
    await assert.rejects(loadContract(path), /Invalid task contract/);
  });

  it("rejects conflicting acceptance checks with the same identity", async () => {
    const directory = await mkdtemp(join(tmpdir(), "deepseek-contract-"));
    const path = join(directory, "task.json");
    await writeFile(
      path,
      JSON.stringify({
        version: 1,
        taskId: "conflicting-acceptance",
        repository: ".",
        objective: "Reject ambiguous independent acceptance definitions.",
        allowedPaths: ["src/**"],
        acceptanceCriteria: ["The independent behavior check is unambiguous"],
        requiredChecks: [],
        acceptanceChecks: [
          {
            id: "stable-behavior",
            runner: "node",
            script: "./checks/expect-enabled.mjs",
          },
          {
            id: "stable-behavior",
            runner: "node",
            script: "./checks/expect-disabled.mjs",
          },
        ],
      }),
    );

    await assert.rejects(
      loadContract(path),
      /duplicate id "stable-behavior" makes check identity ambiguous/,
    );
  });

  it("inherits immutable fields through a repair overlay", async () => {
    const directory = await mkdtemp(join(tmpdir(), "deepseek-contract-"));
    const basePath = await writeBaseContract(directory);
    const repairPath = join(directory, "repair-1.json");
    await writeFile(
      repairPath,
      JSON.stringify({
        version: 1,
        taskId: "base-task-repair-1",
        repair: {
          parentContract: "./base.json",
          iteration: 1,
          findings: [
            {
              id: "response-shape",
              severity: "P1",
              title: "Preserve response shape",
              description: "The repair changed the original response object shape.",
            },
          ],
        },
      }),
    );

    const base = await loadContract(basePath);
    const repair = await loadContract(repairPath);

    assert.equal(repair.taskId, "base-task-repair-1");
    assert.equal(repair.objective, base.objective);
    assert.deepEqual(repair.allowedPaths, base.allowedPaths);
    assert.deepEqual(repair.forbiddenPaths, base.forbiddenPaths);
    assert.deepEqual(repair.acceptanceCriteria, base.acceptanceCriteria);
    assert.deepEqual(repair.baselineChecks, base.baselineChecks);
    assert.deepEqual(repair.requiredChecks, base.requiredChecks);
    assert.deepEqual(repair.acceptanceChecks, base.acceptanceChecks);
    assert.deepEqual(repair.skills, base.skills);
    assert.equal(repair.skills?.invocation, "automatic");
    assert.equal(repair.baseCommit, base.baseCommit);
    assert.equal(repair.lineage.iteration, 1);
    assert.equal(repair.lineage.rootContractPath, basePath);
    assert.equal(repair.lineage.parentContractPath, basePath);
    assert.match(repair.instructions, /保持原始响应结构/);
    assert.match(repair.instructions, /response-shape/);
    assert.deepEqual(repair.lineage.history, [
      {
        iteration: 1,
        findings: repair.lineage.findings,
      },
    ]);

    const repair2Path = join(directory, "repair-2.json");
    await writeFile(
      repair2Path,
      JSON.stringify({
        version: 1,
        taskId: "base-task-repair-2",
        repair: {
          parentContract: "./repair-1.json",
          iteration: 2,
          findings: [
            {
              id: "error-classification",
              severity: "P2",
              title: "Classify validation errors",
              description: "Only policy validation errors should become client responses.",
            },
          ],
        },
      }),
    );
    const repair2 = await loadContract(repair2Path);
    assert.equal(repair2.lineage.iteration, 2);
    assert.equal(repair2.lineage.rootContractPath, basePath);
    assert.equal(repair2.lineage.history.length, 2);
    assert.equal(repair2.lineage.history[0]?.findings[0]?.id, "response-shape");
    assert.equal(repair2.lineage.history[1]?.findings[0]?.id, "error-classification");
    assert.deepEqual(repair2.acceptanceCriteria, base.acceptanceCriteria);
  });

  it("rejects repair overlays that try to replace original criteria", async () => {
    const directory = await mkdtemp(join(tmpdir(), "deepseek-contract-"));
    await writeBaseContract(directory);
    const repairPath = join(directory, "repair-tampered.json");
    await writeFile(
      repairPath,
      JSON.stringify({
        version: 1,
        taskId: "base-task-repair-1",
        objective: "Replace the original objective with a weaker one.",
        repair: {
          parentContract: "./base.json",
          iteration: 1,
          findings: [
            {
              id: "finding-1",
              severity: "P2",
              title: "Fix one issue",
              description: "A sufficiently detailed review finding for validation.",
            },
          ],
        },
      }),
    );

    await assert.rejects(loadContract(repairPath), /Invalid repair contract/);
  });

  it("requires a continuous iteration and rejects lineage cycles", async () => {
    const directory = await mkdtemp(join(tmpdir(), "deepseek-contract-"));
    await writeBaseContract(directory);
    const skippedPath = join(directory, "repair-skipped.json");
    await writeFile(
      skippedPath,
      JSON.stringify({
        version: 1,
        taskId: "base-task-repair-2",
        repair: {
          parentContract: "./base.json",
          iteration: 2,
          findings: [
            {
              id: "finding-2",
              severity: "P2",
              title: "Fix another issue",
              description: "The repair iteration cannot skip its direct parent.",
            },
          ],
        },
      }),
    );
    await assert.rejects(loadContract(skippedPath), /must be 1/);

    const cyclePath = join(directory, "repair-cycle.json");
    await writeFile(
      cyclePath,
      JSON.stringify({
        version: 1,
        taskId: "base-task-cycle",
        repair: {
          parentContract: "./repair-cycle.json",
          iteration: 1,
          findings: [
            {
              id: "cycle-finding",
              severity: "P1",
              title: "Break the cycle",
              description: "A repair contract cannot refer to itself as parent.",
            },
          ],
        },
      }),
    );
    await assert.rejects(loadContract(cyclePath), /lineage cycle/);

    const overLimitPath = join(directory, "repair-over-limit.json");
    await writeFile(
      overLimitPath,
      JSON.stringify({
        version: 1,
        taskId: "base-task-repair-3",
        repair: {
          parentContract: "./base.json",
          iteration: 3,
          findings: [
            {
              id: "finding-3",
              severity: "P2",
              title: "Exceeds repair limit",
              description: "Automatic repair chains cannot contain a third iteration.",
            },
          ],
        },
      }),
    );
    await assert.rejects(loadContract(overLimitPath), /Invalid repair contract/);
  });
});
