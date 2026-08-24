import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const worktree = process.argv[2];
if (!worktree) throw new Error("Runner must pass the execution worktree as argv[2]");

const importFromWorktree = async (path) =>
  await import(`${pathToFileURL(join(worktree, path)).href}?acceptance=${Date.now()}`);

const policy = await importFromWorktree("src/access-policy.js");
const service = await importFromWorktree("src/access-service.js");
const controller = await importFromWorktree("src/access-controller.js");

assert.equal(typeof policy.validateAccessRequest, "function");
assert.equal(typeof policy.AccessRequestTypeError, "function");
assert.equal(typeof policy.AccessRequestRangeError, "function");
assert.equal(typeof service.authorizeAccess, "function");
assert.equal(typeof controller.handleAccessRequest, "function");

const validRequest = {
  enabled: true,
  currentMinute: 600,
  startMinute: 540,
  endMinute: 1020,
};

for (const request of [null, [], "request", 42]) {
  assert.throws(
    () => policy.validateAccessRequest(request),
    (error) => error instanceof policy.AccessRequestTypeError && error instanceof TypeError,
  );
}

assert.throws(
  () => policy.validateAccessRequest({ ...validRequest, enabled: "yes" }),
  (error) => error instanceof policy.AccessRequestTypeError && error instanceof TypeError,
);

for (const [field, value] of [
  ["currentMinute", -1],
  ["currentMinute", 1.5],
  ["startMinute", -1],
  ["endMinute", 1440],
]) {
  assert.throws(
    () => policy.validateAccessRequest({ ...validRequest, [field]: value }),
    (error) => error instanceof policy.AccessRequestRangeError && error instanceof RangeError,
  );
}

for (const enabled of [true, false]) {
  for (const [startMinute, endMinute] of [
    [600, 600],
    [700, 600],
  ]) {
    assert.throws(
      () =>
        policy.validateAccessRequest({
          ...validRequest,
          enabled,
          startMinute,
          endMinute,
        }),
      (error) => error instanceof policy.AccessRequestRangeError && error instanceof RangeError,
    );
  }
}

assert.deepEqual(service.authorizeAccess({ ...validRequest, enabled: false }), {
  allowed: false,
  reason: "account-disabled",
});
assert.deepEqual(service.authorizeAccess({ ...validRequest, currentMinute: 500 }), {
  allowed: false,
  reason: "outside-window",
});
assert.deepEqual(service.authorizeAccess(validRequest), {
  allowed: true,
  reason: "allowed",
});

assert.deepEqual(controller.handleAccessRequest(validRequest), {
  status: 200,
  body: { allowed: true, reason: "allowed" },
});
const invalidResponse = controller.handleAccessRequest({ ...validRequest, currentMinute: -1 });
assert.deepEqual(Object.keys(invalidResponse).sort(), ["body", "status"]);
assert.equal(invalidResponse.status, 400);
assert.deepEqual(Object.keys(invalidResponse.body), ["error"]);
assert.equal(typeof invalidResponse.body.error, "string");

for (const NativeError of [TypeError, RangeError]) {
  const original = new NativeError("unexpected getter failure");
  const request = { ...validRequest };
  Object.defineProperty(request, "currentMinute", {
    enumerable: true,
    get() {
      throw original;
    },
  });
  assert.throws(() => controller.handleAccessRequest(request), (error) => error === original);
}

const serviceSource = await readFile(join(worktree, "src/access-service.js"), "utf8");
assert.match(
  serviceSource,
  /import\s*\{[^}]*isWithinDailyWindow[^}]*\}\s*from\s*["']\.\/daily-window\.js["']/,
  "access-service.js must import the existing isWithinDailyWindow implementation",
);

process.stdout.write("A2 external acceptance checks passed\n");
