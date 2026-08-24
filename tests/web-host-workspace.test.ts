import assert from "node:assert/strict";
import { mkdtemp, mkdir, realpath, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it } from "node:test";
import type { WebHostRpcMethod } from "../src/harness/web-host/client.js";
import {
  resolveWebHostWorkspace,
  verifyWebHostSessionWorkspace,
  WebHostWorkspaceError,
} from "../src/harness/web-host/workspace.js";

const timestamp = "2026-08-21T00:00:00.000Z";

function workspace(path: string, sessionIds: string[] = []) {
  return {
    workspaceId: "workspace-test",
    path,
    title: "Test Workspace",
    sessionIds,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

class FakeWorkspaceClient {
  readonly calls: Array<{ method: WebHostRpcMethod; payload: Record<string, unknown> }> = [];

  constructor(
    private readonly handler: (
      method: WebHostRpcMethod,
      payload: Record<string, unknown>,
    ) => unknown,
  ) {}

  async call<T>(
    method: WebHostRpcMethod,
    payload: Record<string, unknown>,
  ): Promise<T> {
    this.calls.push({ method, payload });
    return this.handler(method, payload) as T;
  }
}

describe("Web Host WorkspaceResolver", () => {
  it("matches an existing Workspace by canonical path", async (context) => {
    const root = await mkdtemp(join(tmpdir(), "dsh-workspace-resolver-"));
    context.after(async () => await rm(root, { recursive: true, force: true }));
    const project = join(root, "project");
    const alias = join(root, "project-alias");
    await mkdir(project);
    await symlink(project, alias);
    const canonicalPath = await realpath(project);
    const client = new FakeWorkspaceClient((method) => {
      assert.equal(method, "workspace.list");
      return { items: [workspace(canonicalPath)], archivedSessionIds: [] };
    });

    const result = await resolveWebHostWorkspace(client, alias);

    assert.equal(result.canonicalPath, canonicalPath);
    assert.equal(result.workspace.workspaceId, "workspace-test");
    assert.equal(result.created, false);
    assert.deepEqual(client.calls.map(({ method }) => method), ["workspace.list"]);
  });

  it("creates a missing Workspace with the canonical path", async (context) => {
    const root = await mkdtemp(join(tmpdir(), "dsh-workspace-create-"));
    context.after(async () => await rm(root, { recursive: true, force: true }));
    const canonicalPath = await realpath(root);
    const client = new FakeWorkspaceClient((method, payload) => {
      if (method === "workspace.list") {
        return { items: [], archivedSessionIds: [] };
      }
      assert.equal(method, "workspace.create");
      assert.deepEqual(payload, { path: canonicalPath });
      return { workspace: workspace(canonicalPath), created: true };
    });

    const result = await resolveWebHostWorkspace(client, root);

    assert.equal(result.created, true);
    assert.deepEqual(client.calls.map(({ method }) => method), [
      "workspace.list",
      "workspace.create",
    ]);
  });

  it("fails closed for duplicate canonical paths or a mismatched create result", async (context) => {
    const root = await mkdtemp(join(tmpdir(), "dsh-workspace-invalid-"));
    context.after(async () => await rm(root, { recursive: true, force: true }));
    const canonicalPath = await realpath(root);
    const duplicate = new FakeWorkspaceClient(() => ({
      items: [
        workspace(canonicalPath),
        { ...workspace(canonicalPath), workspaceId: "workspace-other" },
      ],
      archivedSessionIds: [],
    }));
    await assert.rejects(
      resolveWebHostWorkspace(duplicate, root),
      (error) =>
        error instanceof WebHostWorkspaceError &&
        error.code === "ambiguous-workspace",
    );

    const mismatch = new FakeWorkspaceClient((method) =>
      method === "workspace.list"
        ? { items: [], archivedSessionIds: [] }
        : { workspace: workspace("/wrong/path"), created: true },
    );
    await assert.rejects(
      resolveWebHostWorkspace(mismatch, root),
      (error) =>
        error instanceof WebHostWorkspaceError && error.code === "wrong-workspace",
    );
  });

  it("verifies that the created session belongs to the expected Workspace", async () => {
    const attached = new FakeWorkspaceClient(() => ({
      items: [workspace("/canonical/project", ["session-test"])],
      archivedSessionIds: [],
    }));
    const result = await verifyWebHostSessionWorkspace(
      attached,
      "workspace-test",
      "/canonical/project",
      "session-test",
    );
    assert.deepEqual(result.sessionIds, ["session-test"]);

    const missing = new FakeWorkspaceClient(() => ({
      items: [workspace("/canonical/project")],
      archivedSessionIds: [],
    }));
    await assert.rejects(
      verifyWebHostSessionWorkspace(
        missing,
        "workspace-test",
        "/canonical/project",
        "session-test",
      ),
      (error) =>
        error instanceof WebHostWorkspaceError && error.code === "wrong-workspace",
    );
  });
});
