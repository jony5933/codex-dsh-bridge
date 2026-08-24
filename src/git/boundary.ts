import picomatch from "picomatch";
import type { BoundaryResult } from "../types.js";

export function checkBoundaries(
  changedFiles: string[],
  allowedPatterns: string[],
  forbiddenPatterns: string[],
): BoundaryResult {
  const isAllowed = picomatch(allowedPatterns, { dot: true });
  const isForbidden = forbiddenPatterns.length
    ? picomatch(forbiddenPatterns, { dot: true })
    : () => false;
  const allowedFiles: string[] = [];
  const violations: BoundaryResult["violations"] = [];

  for (const path of changedFiles) {
    if (isForbidden(path)) {
      violations.push({ path, reason: "explicitly-forbidden" });
    } else if (!isAllowed(path)) {
      violations.push({ path, reason: "not-allowed" });
    } else {
      allowedFiles.push(path);
    }
  }

  return { changedFiles, allowedFiles, violations };
}
