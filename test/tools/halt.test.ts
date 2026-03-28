import { describe, it, expect, beforeEach, vi } from "vitest";
import { AgentTree } from "../../src/tree.js";
import { halt, abortAgents } from "../../src/tools/halt.js";

function createCtx() {
  return { cwd: "/tmp" } as any;
}

function mockController(): AbortController {
  const controller = new AbortController();
  vi.spyOn(controller, "abort");
  return controller;
}

describe("abortAgents", () => {
  it("calls abort on controller and marks tree as aborted", async () => {
    const tree = new AgentTree();
    const handles = new Map<string, AbortController>();
    tree.add("id1", "bob", "task");
    const controller = mockController();
    handles.set("id1", controller);

    await abortAgents(["id1"], tree, handles);

    expect(controller.abort).toHaveBeenCalled();
    expect(tree.get("id1")!.status).toBe("aborted");
    expect(handles.has("id1")).toBe(false);
  });

  it("still aborts tree node when no controller handle exists", async () => {
    const tree = new AgentTree();
    const handles = new Map<string, AbortController>();
    tree.add("id1", "bob", "task");
    // No handle set

    await abortAgents(["id1"], tree, handles);

    expect(tree.get("id1")!.status).toBe("aborted");
  });

  it("returns count of aborted agents", async () => {
    const tree = new AgentTree();
    const handles = new Map<string, AbortController>();
    tree.add("a", "bob", "t1");
    tree.add("b", "kevin", "t2");
    handles.set("a", mockController());
    handles.set("b", mockController());

    const count = await abortAgents(["a", "b"], tree, handles);
    expect(count).toBe(2);
  });
});

describe("halt", () => {
  let tree: AgentTree;
  let handles: Map<string, AbortController>;

  beforeEach(() => {
    tree = new AgentTree();
    handles = new Map();
  });

  it("halts a specific running agent by id", async () => {
    tree.add("id1", "bob", "task");
    handles.set("id1", mockController());
    const execute = halt(tree, handles);

    const result = await execute("tc", { id: "id1" }, undefined, undefined, createCtx());

    expect(tree.get("id1")!.status).toBe("aborted");
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toContain("id1");
  });

  it("halts all running agents when id is 'all'", async () => {
    tree.add("a", "bob", "t1");
    tree.add("b", "kevin", "t2");
    handles.set("a", mockController());
    handles.set("b", mockController());
    const execute = halt(tree, handles);

    const result = await execute("tc", { id: "all" }, undefined, undefined, createCtx());

    expect(tree.get("a")!.status).toBe("aborted");
    expect(tree.get("b")!.status).toBe("aborted");
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toContain("2");
  });

  it("throws for unknown agent id", async () => {
    const execute = halt(tree, handles);

    await expect(
      execute("tc", { id: "nope" }, undefined, undefined, createCtx()),
    ).rejects.toThrow(/nope/);
  });

  it("returns info (not error) for already-completed agent", async () => {
    tree.add("id1", "bob", "task");
    tree.updateStatus("id1", "completed", 0);
    const execute = halt(tree, handles);

    const result = await execute("tc", { id: "id1" }, undefined, undefined, createCtx());

    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toContain("completed");
  });

  it("returns info when 'all' but nothing is running", async () => {
    const execute = halt(tree, handles);

    const result = await execute("tc", { id: "all" }, undefined, undefined, createCtx());

    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toContain("No");
  });
});
