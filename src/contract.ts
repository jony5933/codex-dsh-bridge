import { access, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ErrorObject } from "ajv";
import type { ReviewFinding, TaskContract } from "./types.js";

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
interface Validator {
  (data: unknown): boolean;
  errors?: ErrorObject[] | null;
}
interface AjvInstance {
  compile(schema: object): Validator;
}
type AjvConstructor = new (options: Record<string, unknown>) => AjvInstance;
const Ajv2020 = (require("ajv/dist/2020").default ?? require("ajv/dist/2020")) as AjvConstructor;
async function findSchemaPath(filename: string): Promise<string> {
  const candidates = [
    resolve(moduleDirectory, `../contracts/${filename}`),
    resolve(moduleDirectory, `../../contracts/${filename}`),
  ];
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next source/build layout.
    }
  }
  throw new Error(`Cannot locate contracts/${filename}`);
}

type RawContract = Partial<TaskContract> & Record<string, unknown>;

interface RawRepairContract {
  version: 1;
  taskId: string;
  repair: {
    parentContract: string;
    iteration: number;
    findings: ReviewFinding[];
  };
}

function formatValidationError(error: ErrorObject): string {
  const location = error.instancePath || "/";
  return `${location} ${error.message ?? "is invalid"}`;
}

async function validateDocument(
  raw: unknown,
  schemaFilename: string,
  useDefaults: boolean,
): Promise<void> {
  const schemaText = await readFile(await findSchemaPath(schemaFilename), "utf8");
  const schema = JSON.parse(schemaText) as object;
  const ajv = new Ajv2020({ allErrors: true, useDefaults, strict: false });
  const validate = ajv.compile(schema);

  if (!validate(raw)) {
    const details = (validate.errors ?? []).map(formatValidationError).join("\n");
    throw new Error(`Invalid ${schemaFilename === "repair.schema.json" ? "repair" : "task"} contract:\n${details}`);
  }
}

function buildRepairInstructions(
  parentInstructions: string,
  iteration: number,
  findings: ReviewFinding[],
): string {
  const findingLines = findings.map(
    (finding) =>
      `- [${finding.severity}] ${finding.id} — ${finding.title}: ${finding.description}`,
  );
  return [
    parentInstructions,
    `# 返修 iteration ${iteration}`,
    "原始 objective、allowedPaths、forbiddenPaths、acceptanceCriteria、baselineChecks、requiredChecks、acceptanceChecks 和 skills 已由 Runner 从父 Contract 不可变继承，不得删改或弱化。",
    "需要解决的 Codex review findings：",
    ...findingLines,
  ]
    .filter((line) => line.length > 0)
    .join("\n\n");
}

function assertUniqueAcceptanceCheckIds(contract: TaskContract): void {
  const seen = new Set<string>();
  for (const check of contract.acceptanceChecks) {
    if (seen.has(check.id)) {
      throw new Error(
        `Invalid task contract:\n/acceptanceChecks duplicate id "${check.id}" makes check identity ambiguous`,
      );
    }
    seen.add(check.id);
  }
}

async function loadContractInternal(
  absoluteContractPath: string,
  ancestors: Set<string>,
): Promise<TaskContract> {
  if (ancestors.has(absoluteContractPath)) {
    throw new Error(`Contract lineage cycle detected at ${absoluteContractPath}`);
  }
  const nextAncestors = new Set(ancestors).add(absoluteContractPath);
  const contractText = await readFile(absoluteContractPath, "utf8");
  const raw = JSON.parse(contractText) as RawContract & { repair?: unknown };

  if (Object.hasOwn(raw, "repair")) {
    await validateDocument(raw, "repair.schema.json", false);
    const repair = raw as unknown as RawRepairContract;
    const parentContractPath = resolve(
      dirname(absoluteContractPath),
      repair.repair.parentContract,
    );
    const parent = await loadContractInternal(parentContractPath, nextAncestors);
    const expectedIteration = parent.lineage.iteration + 1;
    if (repair.repair.iteration !== expectedIteration) {
      throw new Error(
        `Invalid repair contract:\n/repair/iteration must be ${expectedIteration} for parent iteration ${parent.lineage.iteration}`,
      );
    }

    return {
      ...parent,
      taskId: repair.taskId,
      instructions: buildRepairInstructions(
        parent.instructions,
        repair.repair.iteration,
        repair.repair.findings,
      ),
      lineage: {
        contractPath: absoluteContractPath,
        rootContractPath: parent.lineage.rootContractPath,
        parentContractPath,
        iteration: repair.repair.iteration,
        findings: [...repair.repair.findings],
        history: [
          ...parent.lineage.history,
          {
            iteration: repair.repair.iteration,
            findings: [...repair.repair.findings],
          },
        ],
      },
    };
  }

  await validateDocument(raw, "task.schema.json", true);
  const contract = raw as unknown as TaskContract;
  assertUniqueAcceptanceCheckIds(contract);
  if (
    contract.skills !== undefined &&
    !contract.harness.args.some((argument) => argument.includes("{skillPatch}"))
  ) {
    throw new Error(
      "Invalid task contract:\n/harness/args must include {skillPatch} when skills is configured",
    );
  }
  if (
    contract.skills === undefined &&
    contract.harness.args.some((argument) => argument.includes("{skillPatch}"))
  ) {
    throw new Error(
      "Invalid task contract:\n/harness/args cannot include {skillPatch} without skills configuration",
    );
  }
  contract.repository = resolve(dirname(absoluteContractPath), contract.repository);
  contract.lineage = {
    contractPath: absoluteContractPath,
    rootContractPath: absoluteContractPath,
    iteration: 0,
    findings: [],
    history: [],
  };
  return contract;
}

export async function loadContract(contractPath: string): Promise<TaskContract> {
  const absoluteContractPath = resolve(contractPath);
  return await loadContractInternal(absoluteContractPath, new Set());
}
