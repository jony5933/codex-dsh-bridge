import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readBridgeVersion } from "../src/version.js";

describe("Bridge package version", () => {
  it("reads the source/build package manifest without duplicating the version", async () => {
    assert.equal(await readBridgeVersion(), "0.1.0-beta.1");
  });
});
