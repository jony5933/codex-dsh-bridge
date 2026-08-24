import { access, readFile, realpath, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ErrorObject } from "ajv";
import { loadReviewEvidence, normalizeRunReport, type ReviewEvidence } from "./evidence.js";
import type { ReviewArtifact, RunReport } from "./types.js";

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

export async function findReviewSchemaPath(): Promise<string> {
  const candidates = [
    resolve(moduleDirectory, "../contracts/review.schema.json"),
    resolve(moduleDirectory, "../../contracts/review.schema.json"),
  ];
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next source/build layout.
    }
  }
  throw new Error("Cannot locate contracts/review.schema.json");
}

function isInside(parent: string, candidate: string): boolean {
  const pathFromParent = relative(parent, candidate);
  return (
    pathFromParent === "" ||
    (!pathFromParent.startsWith("..") && !isAbsolute(pathFromParent))
  );
}

function validateSemantics(review: ReviewArtifact, report: ReviewEvidence): void {
  if (!review.runId.trim() || !review.taskId.trim() || !review.summary.trim()) {
    throw new Error("Review identity and summary must not be empty");
  }
  if (review.runId !== report.runId) {
    throw new Error(`Review runId ${review.runId} does not match report ${report.runId}`);
  }
  if (review.taskId !== report.taskId) {
    throw new Error(`Review taskId ${review.taskId} does not match report ${report.taskId}`);
  }

  const findingIds = new Set<string>();
  for (const finding of review.findings) {
    if (!/^[a-z0-9][a-z0-9._-]{1,63}$/.test(finding.id)) {
      throw new Error(`Review finding id is invalid: ${finding.id}`);
    }
    if (
      !finding.title.trim() ||
      !finding.file.trim() ||
      !finding.evidence.trim() ||
      !finding.minimalFix.trim()
    ) {
      throw new Error(`Review finding ${finding.id} contains an empty required field`);
    }
    if (findingIds.has(finding.id)) {
      throw new Error(`Review finding id must be unique: ${finding.id}`);
    }
    findingIds.add(finding.id);
    if (
      finding.startLine !== null &&
      finding.endLine !== null &&
      finding.endLine < finding.startLine
    ) {
      throw new Error(`Review finding ${finding.id} has endLine before startLine`);
    }
    if (
      (finding.startLine !== null && finding.startLine < 1) ||
      (finding.endLine !== null && finding.endLine < 1)
    ) {
      throw new Error(`Review finding ${finding.id} line numbers must be positive`);
    }
  }

  if (review.blockers.some((blocker) => !blocker.trim())) {
    throw new Error("Review blockers must not be empty");
  }
  if (new Set(review.blockers).size !== review.blockers.length) {
    throw new Error("Review blockers must be unique");
  }

  const openFindings = review.findings.filter((finding) => finding.resolution === "open");
  if (report.status === "blocked" && review.status !== "blocked") {
    throw new Error("Blocked execution evidence can only produce a blocked review");
  }
  if (review.status === "approved") {
    if (report.status !== "passed") {
      throw new Error("An approved review requires passed execution evidence");
    }
    if (openFindings.length > 0) {
      throw new Error("An approved review cannot contain open findings");
    }
  }
  if (review.status === "changes-requested" && openFindings.length === 0) {
    throw new Error("A changes-requested review requires at least one open finding");
  }
  if (review.status === "blocked" && review.blockers.length === 0) {
    throw new Error("A blocked review requires at least one blocker");
  }
  if (review.status !== "blocked" && review.blockers.length > 0) {
    throw new Error("Only a blocked review may contain blockers");
  }
}

export async function validateReviewArtifact(
  raw: unknown,
  report: ReviewEvidence | RunReport,
): Promise<ReviewArtifact> {
  const schema = JSON.parse(await readFile(await findReviewSchemaPath(), "utf8")) as object;
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const validate = ajv.compile(schema);
  if (!validate(raw)) {
    const details = (validate.errors ?? [])
      .map((error) => `${error.instancePath || "/"} ${error.message ?? "is invalid"}`)
      .join("\n");
    throw new Error(`Invalid review artifact:\n${details}`);
  }
  const review = raw as ReviewArtifact;
  validateSemantics(review, "channel" in report ? report : normalizeRunReport(report));
  return review;
}

export async function recordReviewArtifact(
  reportPath: string,
  candidatePath: string,
): Promise<{ review: ReviewArtifact; reviewPath: string }> {
  const absoluteReportPath = await realpath(resolve(reportPath));
  const absoluteCandidatePath = await realpath(resolve(candidatePath));
  const report = await loadReviewEvidence(
    JSON.parse(await readFile(absoluteReportPath, "utf8")) as unknown,
  );
  const worktree = await realpath(report.worktree);
  const artifactDirectory = await realpath(dirname(absoluteReportPath));

  if (isInside(worktree, absoluteReportPath) || isInside(worktree, artifactDirectory)) {
    throw new Error("Review artifacts must be stored outside the execution worktree");
  }
  if (isInside(worktree, absoluteCandidatePath)) {
    throw new Error("Review candidate must be created outside the execution worktree");
  }

  const raw = JSON.parse(await readFile(absoluteCandidatePath, "utf8")) as unknown;
  const review = await validateReviewArtifact(raw, report);
  const reviewPath = join(artifactDirectory, "review.json");
  await writeFile(reviewPath, `${JSON.stringify(review, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  return { review, reviewPath };
}
