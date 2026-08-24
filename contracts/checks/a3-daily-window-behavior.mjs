import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const worktree = process.argv[2];
if (!worktree) throw new Error("Runner must pass the execution worktree as argv[2]");

const sourcePath = join(worktree, "src/daily-window.js");
const source = await readFile(sourcePath, "utf8");
const dailyWindow = await import(
  `${pathToFileURL(sourcePath).href}?acceptance=${Date.now()}`
);

assert.deepEqual(Object.keys(dailyWindow).sort(), ["isWithinDailyWindow"]);
assert.equal(typeof dailyWindow.isWithinDailyWindow, "function");

const { isWithinDailyWindow } = dailyWindow;

for (const [currentMinute, startMinute, endMinute, expected] of [
  [0, 0, 1, true],
  [1, 0, 1, false],
  [539, 540, 1020, false],
  [540, 540, 1020, true],
  [1019, 540, 1020, true],
  [1020, 540, 1020, false],
  [1438, 1438, 1439, true],
  [1439, 1438, 1439, false],
]) {
  assert.equal(
    isWithinDailyWindow(currentMinute, startMinute, endMinute),
    expected,
  );
}

const invalidCases = [
  [[-1, -2, 1440], "currentMinute must be an integer from 0 through 1439"],
  [[540, -1, 1440], "startMinute must be an integer from 0 through 1439"],
  [[540, 0, 1440], "endMinute must be an integer from 0 through 1439"],
  [[540.5, 0, 100], "currentMinute must be an integer from 0 through 1439"],
  [[540, "0", 100], "startMinute must be an integer from 0 through 1439"],
  [[540, 0, Number.NaN], "endMinute must be an integer from 0 through 1439"],
  [[600, 600, 600], "startMinute must be earlier than endMinute"],
  [[1380, 1320, 360], "startMinute must be earlier than endMinute"],
];

for (const [args, expectedMessage] of invalidCases) {
  assert.throws(
    () => isWithinDailyWindow(...args),
    (error) =>
      error instanceof RangeError &&
      error.constructor === RangeError &&
      error.message === expectedMessage,
  );
}

for (const oldCall of [
  'assertMinuteOfDay(currentMinute, "currentMinute")',
  'assertMinuteOfDay(startMinute, "startMinute")',
  'assertMinuteOfDay(endMinute, "endMinute")',
]) {
  assert.equal(
    source.includes(oldCall),
    false,
    "the refactor must replace the three repeated direct validation calls",
  );
}

process.stdout.write("A3 external behavior checks passed\n");
