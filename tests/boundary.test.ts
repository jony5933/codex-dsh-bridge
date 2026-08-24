import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkBoundaries } from "../src/git/boundary.js";

describe("checkBoundaries", () => {
  it("accepts files matched by allowed patterns", () => {
    const result = checkBoundaries(
      ["src/auth/login.ts", "tests/auth/login.test.ts"],
      ["src/auth/**", "tests/auth/**"],
      [],
    );
    assert.deepEqual(result.violations, []);
    assert.equal(result.allowedFiles.length, 2);
  });

  it("gives forbidden patterns precedence", () => {
    const result = checkBoundaries(
      ["src/auth/login.ts", "src/auth/.env.local", "package.json"],
      ["src/**"],
      ["**/.env*"],
    );
    assert.deepEqual(result.violations, [
      { path: "src/auth/.env.local", reason: "explicitly-forbidden" },
      { path: "package.json", reason: "not-allowed" },
    ]);
  });
});
