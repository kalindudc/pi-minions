import { describe, it, expect, beforeEach, vi } from "vitest";
import { AgentTree } from "../src/tree.js";

let tree: AgentTree;

beforeEach(() => {
  tree = new AgentTree();
});

describe("add / get", () => {
  it("adds a root agent node", () => {
    const node = tree.add("id1", "bob", "do the thing");
    expect(node.id).toBe("id1");
    expect(node.name).toBe("bob");
    expect(node.task).toBe("do the thing");
    expect(node.status).toBe("running");
    expect(node.parentId).toBeUndefined();
    expect(node.children).toEqual([]);
  });

  it("adds a child agent node with parentId", () => {
    tree.add("parent", "kevin", "parent task");
    const child = tree.add("child", "dave", "child task", "parent");
    expect(child.parentId).toBe("parent");
    expect(tree.get("parent")!.children).toContain("child");
  });

  it("get returns undefined for unknown id", () => {
    expect(tree.get("nope")).toBeUndefined();
  });

  it("get returns node for known id", () => {
    tree.add("id1", "bob", "task");
    expect(tree.get("id1")?.name).toBe("bob");
  });
});

describe("getRunning", () => {
  it("returns only running nodes", () => {
    tree.add("a", "bob", "t1");
    tree.add("b", "kevin", "t2");
    tree.updateStatus("b", "completed", 0);
    const running = tree.getRunning();
    expect(running.map((n) => n.id)).toEqual(["a"]);
  });

  it("returns empty array when none running", () => {
    tree.add("a", "bob", "t1");
    tree.updateStatus("a", "aborted");
    expect(tree.getRunning()).toEqual([]);
  });
});

describe("getRoots", () => {
  it("returns nodes with no parentId", () => {
    tree.add("root1", "bob", "t1");
    tree.add("root2", "kevin", "t2");
    tree.add("child", "dave", "t3", "root1");
    const roots = tree.getRoots();
    expect(roots.map((n) => n.id).sort()).toEqual(["root1", "root2"]);
  });
});

describe("getDepth", () => {
  it("root node has depth 0", () => {
    tree.add("root", "bob", "t");
    expect(tree.getDepth("root")).toBe(0);
  });

  it("child has depth 1", () => {
    tree.add("root", "bob", "t");
    tree.add("child", "dave", "t", "root");
    expect(tree.getDepth("child")).toBe(1);
  });

  it("grandchild has depth 2", () => {
    tree.add("root", "bob", "t");
    tree.add("child", "dave", "t", "root");
    tree.add("grand", "kevin", "t", "child");
    expect(tree.getDepth("grand")).toBe(2);
  });

  it("returns 0 for unknown id", () => {
    expect(tree.getDepth("nope")).toBe(0);
  });
});

describe("updateStatus", () => {
  it("transitions status", () => {
    tree.add("a", "bob", "t");
    tree.updateStatus("a", "completed", 0);
    expect(tree.get("a")!.status).toBe("completed");
    expect(tree.get("a")!.exitCode).toBe(0);
    expect(tree.get("a")!.endTime).toBeDefined();
  });

  it("sets error message", () => {
    tree.add("a", "bob", "t");
    tree.updateStatus("a", "failed", 1, "something went wrong");
    expect(tree.get("a")!.error).toBe("something went wrong");
  });
});

describe("updateUsage", () => {
  it("merges usage fields", () => {
    tree.add("a", "bob", "t");
    tree.updateUsage("a", { input: 100, turns: 2 });
    const node = tree.get("a")!;
    expect(node.usage.input).toBe(100);
    expect(node.usage.turns).toBe(2);
    expect(node.usage.output).toBe(0); // unchanged
  });
});

describe("remove", () => {
  it("removes a single node", () => {
    tree.add("a", "bob", "t");
    tree.remove("a");
    expect(tree.get("a")).toBeUndefined();
  });

  it("removes children recursively", () => {
    tree.add("root", "bob", "t");
    tree.add("child", "dave", "t", "root");
    tree.add("grand", "kevin", "t", "child");
    tree.remove("root");
    expect(tree.get("root")).toBeUndefined();
    expect(tree.get("child")).toBeUndefined();
    expect(tree.get("grand")).toBeUndefined();
  });

  it("removes child reference from parent", () => {
    tree.add("root", "bob", "t");
    tree.add("child", "dave", "t", "root");
    tree.remove("child");
    expect(tree.get("root")!.children).not.toContain("child");
  });

  it("is a no-op for unknown id", () => {
    tree.add("a", "bob", "t");
    expect(() => tree.remove("nope")).not.toThrow();
    expect(tree.get("a")).toBeDefined();
  });
});

describe("updateActivity", () => {
  it("sets lastActivity on node", () => {
    const tree = new AgentTree();
    tree.add("a", "kevin", "do stuff");
    tree.updateActivity("a", "→ $ ls -la");
    expect(tree.get("a")!.lastActivity).toBe("→ $ ls -la");
  });

  it("is no-op for unknown id", () => {
    const tree = new AgentTree();
    expect(() => tree.updateActivity("nope", "test")).not.toThrow();
  });
});

describe("onChange", () => {
  it("fires on add", () => {
    const tree = new AgentTree();
    const listener = vi.fn();
    tree.onChange(listener);
    tree.add("a", "kevin", "do stuff");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("fires on updateStatus", () => {
    const tree = new AgentTree();
    tree.add("a", "kevin", "do stuff");
    const listener = vi.fn();
    tree.onChange(listener);
    tree.updateStatus("a", "completed", 0);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("fires on remove", () => {
    const tree = new AgentTree();
    tree.add("a", "kevin", "do stuff");
    const listener = vi.fn();
    tree.onChange(listener);
    tree.remove("a");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("unsubscribe stops notifications", () => {
    const tree = new AgentTree();
    const listener = vi.fn();
    const unsub = tree.onChange(listener);
    tree.add("a", "kevin", "do stuff");
    expect(listener).toHaveBeenCalledTimes(1);
    unsub();
    tree.add("b", "bob", "more");
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
