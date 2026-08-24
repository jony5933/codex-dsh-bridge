import { access, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ErrorObject } from "ajv";
import type { RunReport } from "./types.js";

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

export async function findRunReportSchemaPath(): Promise<string> {
  const candidates = [
    resolve(moduleDirectory, "../contracts/result.schema.json"),
    resolve(moduleDirectory, "../../contracts/result.schema.json"),
  ];
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next source/build layout.
    }
  }
  throw new Error("Cannot locate contracts/result.schema.json");
}

export async function validateRunReport(raw: unknown): Promise<RunReport> {
  const schema = JSON.parse(await readFile(await findRunReportSchemaPath(), "utf8")) as object;
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const validate = ajv.compile(schema);
  if (!validate(raw)) {
    const details = (validate.errors ?? [])
      .map((error) => `${error.instancePath || "/"} ${error.message ?? "is invalid"}`)
      .join("\n");
    throw new Error(`Invalid Runner result:\n${details}`);
  }
  return raw as RunReport;
}
