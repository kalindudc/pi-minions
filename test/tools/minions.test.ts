import { describe, it, expect, vi } from "vitest";
import { AgentTree } from "../../src/tree.js";
import { ResultQueue } from "../../src/queue.js";
import { makeListMinionsExecute, makeShowMinionExecute, makeSteerMinionExecute } from "../../src/tools/minions.js";
import type { DetachHandle } from "../../src/tools/spawn.js";
import type { MinionSession } from "../../src/spawn.js";
import { emptyUsage } from "../../src/types.js";

function makeCtx() {
  return { cwd: "/tmp", modelRegistry: {}, model: undefined, ui: { setWorkingMessage: vi.fn() } } as any;
}

describe("makeListMinionsExecute", () => {
  it("returns message when no minions", async () => {
    const tree = new AgentTree();
    const queue = new ResultQueue();
    const detachHandles = new Map<string, DetachHandle>();
    const execute = makeListMinionsExecute(tree, queue, detachHandles);

    const result = await execute("tc-1", {}, undefined, undefined, makeCtx());
    const text = (result.content[0] as any).text;
    expect(text).toContain("No running or pending");
  });

  it("lists running minions with fg/bg labels", async () => {
    const tree = new AgentTree();
    const queue = new ResultQueue();
    const detachHandles = new Map<string, DetachHandle>();

    tree.add("a", "kevin", "task A");
    tree.add("b", "bob", "task B");
    detachHandles.set("a", { resolve: () => {} }); // kevin is foreground

    const execute = makeListMinionsExecute(tree, queue, detachHandles);
    const result = await execute("tc-1", {}, undefined, undefined, makeCtx());
    const text = (result.content[0] as any).text;

    expect(text).toContain("kevin");
    expect(text).toContain("foreground");
    expect(text).toContain("bob");
    expect(text).toContain("background");
  });

  it("lists pending queue results", async () => {
    const tree = new AgentTree();
    const queue = new ResultQueue();
    const detachHandles = new Map<string, DetachHandle>();

    queue.add({
      id: "x", name: "mel", task: "do stuff", output: "done",
      usage: emptyUsage(), status: "pending", completedAt: Date.now(),
      duration: 1000, exitCode: 0,
    });

    const execute = makeListMinionsExecute(tree, queue, detachHandles);
    const result = await execute("tc-1", {}, undefined, undefined, makeCtx());
    const text = (result.content[0] as any).text;

    expect(text).toContain("mel");
    expect(text).toContain("Pending");
  });
});

describe("makeShowMinionExecute", () => {
  it("throws for unknown minion", async () => {
    const tree = new AgentTree();
    const queue = new ResultQueue();
    const execute = makeShowMinionExecute(tree, queue);

    await expect(
      execute("tc-1", { target: "nope" }, undefined, undefined, makeCtx()),
    ).rejects.toThrow(/not found/);
  });

  it("shows running minion with activity", async () => {
    const tree = new AgentTree();
    const queue = new ResultQueue();
    tree.add("a", "kevin", "analyze code");
    tree.updateActivity("a", "→ $ grep -r TODO");

    const execute = makeShowMinionExecute(tree, queue);
    const result = await execute("tc-1", { target: "kevin" }, undefined, undefined, makeCtx());
    const text = (result.content[0] as any).text;

    expect(text).toContain("kevin");
    expect(text).toContain("running");
    expect(text).toContain("→ $ grep -r TODO");
    expect(text).toContain("Running for:");
  });

  it("shows completed minion with queue output", async () => {
    const tree = new AgentTree();
    const queue = new ResultQueue();
    tree.add("a", "kevin", "analyze code");
    tree.updateStatus("a", "completed", 0);

    queue.add({
      id: "a", name: "kevin", task: "analyze code", output: "found 3 TODOs",
      usage: emptyUsage(), status: "pending", completedAt: Date.now(),
      duration: 5000, exitCode: 0,
    });

    const execute = makeShowMinionExecute(tree, queue);
    const result = await execute("tc-1", { target: "a" }, undefined, undefined, makeCtx());
    const text = (result.content[0] as any).text;

    expect(text).toContain("completed");
    expect(text).toContain("found 3 TODOs");
  });

  it("resolves by name via tree.resolve", async () => {
    const tree = new AgentTree();
    const queue = new ResultQueue();
    tree.add("abc123", "kevin", "task");

    const execute = makeShowMinionExecute(tree, queue);
    const result = await execute("tc-1", { target: "kevin" }, undefined, undefined, makeCtx());
    const text = (result.content[0] as any).text;
    expect(text).toContain("abc123");
  });
});

describe("makeSteerMinionExecute", () => {
  it("throws for unknown minion", async () => {
    const tree = new AgentTree();
    const sessions = new Map<string, MinionSession>();
    const execute = makeSteerMinionExecute(tree, sessions);

    await expect(
      execute("tc-1", { target: "nope", message: "hello" }, undefined, undefined, makeCtx()),
    ).rejects.toThrow(/not found/);
  });

  it("throws for non-running minion", async () => {
    const tree = new AgentTree();
    const sessions = new Map<string, MinionSession>();
    tree.add("a", "kevin", "task");
    tree.updateStatus("a", "completed", 0);

    const execute = makeSteerMinionExecute(tree, sessions);
    await expect(
      execute("tc-1", { target: "a", message: "hello" }, undefined, undefined, makeCtx()),
    ).rejects.toThrow(/not running/);
  });

  it("throws when no active session", async () => {
    const tree = new AgentTree();
    const sessions = new Map<string, MinionSession>();
    tree.add("a", "kevin", "task");

    const execute = makeSteerMinionExecute(tree, sessions);
    await expect(
      execute("tc-1", { target: "a", message: "hello" }, undefined, undefined, makeCtx()),
    ).rejects.toThrow(/No active session/);
  });

  it("calls session.steer with the message", async () => {
    const tree = new AgentTree();
    const sessions = new Map<string, MinionSession>();
    const steerFn = vi.fn().mockResolvedValue(undefined);
    tree.add("a", "kevin", "task");
    sessions.set("a", { steer: steerFn });

    const execute = makeSteerMinionExecute(tree, sessions);
    const result = await execute(
      "tc-1", { target: "kevin", message: "restart the count" },
      undefined, undefined, makeCtx(),
    );
    const text = (result.content[0] as any).text;

    expect(steerFn).toHaveBeenCalledWith("restart the count");
    expect(text).toContain("Steered kevin");
    expect(text).toContain("restart the count");
  });
});
