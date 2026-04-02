import { describe, it, expect, vi } from "vitest";
import { AgentTree } from "../../src/tree.js";
import { ResultQueue } from "../../src/queue.js";
import { SubsessionManager } from "../../src/subsessions/manager.js";
import { listMinions, showMinion, steerMinion, buildListMinionsText, buildShowMinionText, validateSteerTarget, executeSteering } from "../../src/tools/minions.js";
import { emptyUsage } from "../../src/types.js";

function createMockSubsessionManager(sessions: Map<string, any> = new Map()) {
  return {
    getSession: vi.fn().mockImplementation((id: string) => sessions.get(id)),
    updateStatus: vi.fn(),
    list: vi.fn().mockReturnValue([]),
    getMetadata: vi.fn(),
    activeSessions: sessions,
  } as unknown as SubsessionManager;
}

function mockSession() {
  return {
    abort: vi.fn(),
    steer: vi.fn().mockResolvedValue(undefined),
    state: { messages: [] },
    getSessionStats: vi.fn().mockReturnValue({
      tokens: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0, total: 150 },
      cost: 0.001,
    }),
  };
}

function createCtx() {
  return { cwd: "/tmp", modelRegistry: {}, model: undefined, ui: { setWorkingMessage: vi.fn() } } as any;
}

describe("listMinions", () => {
  it("returns message when no minions", async () => {
    const tree = new AgentTree();
    const queue = new ResultQueue();
    const sessions = new Map<string, any>();
    const subsessionManager = createMockSubsessionManager(sessions);
    const execute = listMinions(tree, queue, subsessionManager);

    const result = await execute("tc-1", {}, undefined, undefined, createCtx());
    const text = (result.content[0] as any).text;
    expect(text).toContain("No running or pending");
  });

  it("lists running minions with fg/bg labels", async () => {
    const tree = new AgentTree();
    const queue = new ResultQueue();
    const sessions = new Map<string, any>();

    tree.add("a", "kevin", "task A");
    tree.add("b", "bob", "task B");
    // bob is detached = background
    tree.markDetached("b");
    // kevin is not detached = foreground

    const subsessionManager = createMockSubsessionManager(sessions);
    const execute = listMinions(tree, queue, subsessionManager);
    const result = await execute("tc-1", {}, undefined, undefined, createCtx());
    const text = (result.content[0] as any).text;

    expect(text).toContain("kevin");
    expect(text).toContain("foreground");
    expect(text).toContain("bob");
    expect(text).toContain("background");
  });

  it("lists pending queue results", async () => {
    const tree = new AgentTree();
    const queue = new ResultQueue();
    const sessions = new Map<string, any>();
    const subsessionManager = createMockSubsessionManager(sessions);

    queue.add({
      id: "x", name: "mel", task: "do stuff", output: "done",
      usage: emptyUsage(), status: "pending", completedAt: Date.now(),
      duration: 1000, exitCode: 0,
    });

    const execute = listMinions(tree, queue, subsessionManager);
    const result = await execute("tc-1", {}, undefined, undefined, createCtx());
    const text = (result.content[0] as any).text;

    expect(text).toContain("mel");
    expect(text).toContain("Pending");
  });
});

describe("showMinion", () => {
  it("throws for unknown minion", async () => {
    const tree = new AgentTree();
    const queue = new ResultQueue();
    const execute = showMinion(tree, queue);

    await expect(
      execute("tc-1", { target: "nope" }, undefined, undefined, createCtx()),
    ).rejects.toThrow(/not found/);
  });

  it("shows running minion with activity", async () => {
    const tree = new AgentTree();
    const queue = new ResultQueue();
    tree.add("a", "kevin", "analyze code");
    tree.updateActivity("a", "→ $ grep -r TODO");

    const execute = showMinion(tree, queue);
    const result = await execute("tc-1", { target: "kevin" }, undefined, undefined, createCtx());
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

    const execute = showMinion(tree, queue);
    const result = await execute("tc-1", { target: "a" }, undefined, undefined, createCtx());
    const text = (result.content[0] as any).text;

    expect(text).toContain("completed");
    expect(text).toContain("found 3 TODOs");
  });

  it("resolves by name via tree.resolve", async () => {
    const tree = new AgentTree();
    const queue = new ResultQueue();
    tree.add("abc123", "kevin", "task");

    const execute = showMinion(tree, queue);
    const result = await execute("tc-1", { target: "kevin" }, undefined, undefined, createCtx());
    const text = (result.content[0] as any).text;
    expect(text).toContain("abc123");
  });
});

describe("steerMinion", () => {
  it("throws for unknown minion", async () => {
    const tree = new AgentTree();
    const sessions = new Map<string, any>();
    const subsessionManager = createMockSubsessionManager(sessions);
    const execute = steerMinion(tree, subsessionManager);

    await expect(
      execute("tc-1", { target: "nope", message: "hello" }, undefined, undefined, createCtx()),
    ).rejects.toThrow(/not found/);
  });

  it("throws for non-running minion", async () => {
    const tree = new AgentTree();
    const sessions = new Map<string, any>();
    const subsessionManager = createMockSubsessionManager(sessions);
    tree.add("a", "kevin", "task");
    tree.updateStatus("a", "completed", 0);

    const execute = steerMinion(tree, subsessionManager);
    await expect(
      execute("tc-1", { target: "a", message: "hello" }, undefined, undefined, createCtx()),
    ).rejects.toThrow(/not running/);
  });

  it("throws when no active session", async () => {
    const tree = new AgentTree();
    const sessions = new Map<string, any>();
    const subsessionManager = createMockSubsessionManager(sessions);
    tree.add("a", "kevin", "task");

    const execute = steerMinion(tree, subsessionManager);
    await expect(
      execute("tc-1", { target: "a", message: "hello" }, undefined, undefined, createCtx()),
    ).rejects.toThrow(/No active session/);
  });

  it("calls session.steer with the message", async () => {
    const tree = new AgentTree();
    const sessions = new Map<string, any>();
    const mockSessionObj = mockSession();
    tree.add("a", "kevin", "task");
    sessions.set("a", mockSessionObj);
    const subsessionManager = createMockSubsessionManager(sessions);

    const execute = steerMinion(tree, subsessionManager);
    const result = await execute(
      "tc-1", { target: "kevin", message: "restart the count" },
      undefined, undefined, createCtx(),
    );
    const text = (result.content[0] as any).text;

    expect(mockSessionObj.steer).toHaveBeenCalledWith(expect.stringContaining("[USER STEER]"));
    expect(mockSessionObj.steer).toHaveBeenCalledWith(expect.stringContaining("restart the count"));
    expect(text).toContain("Steered kevin");
    expect(text).toContain("restart the count");
  });
});

describe("buildListMinionsText", () => {
  it("returns no minions message when empty", () => {
    const tree = new AgentTree();
    const queue = new ResultQueue();
    const sessions = new Map<string, any>();
    const subsessionManager = createMockSubsessionManager(sessions);

    const text = buildListMinionsText(tree, queue, subsessionManager);
    expect(text).toContain("No running or pending minions.");
  });

  it("labels running minions as foreground when not detached", () => {
    const tree = new AgentTree();
    const queue = new ResultQueue();
    const sessions = new Map<string, any>();

    tree.add("a", "kevin", "task A");
    // Not marked as detached = foreground

    const subsessionManager = createMockSubsessionManager(sessions);
    const text = buildListMinionsText(tree, queue, subsessionManager);
    expect(text).toContain("kevin");
    expect(text).toContain("foreground");
  });

  it("labels running minions as background when detached", () => {
    const tree = new AgentTree();
    const queue = new ResultQueue();
    const sessions = new Map<string, any>();

    tree.add("b", "bob", "task B");
    tree.markDetached("b"); // Mark as detached = background

    const subsessionManager = createMockSubsessionManager(sessions);
    const text = buildListMinionsText(tree, queue, subsessionManager);
    expect(text).toContain("bob");
    expect(text).toContain("background");
  });

  it("includes pending queue results in output", () => {
    const tree = new AgentTree();
    const queue = new ResultQueue();
    const sessions = new Map<string, any>();
    const subsessionManager = createMockSubsessionManager(sessions);

    queue.add({
      id: "x", name: "mel", task: "do stuff", output: "done",
      usage: emptyUsage(), status: "pending", completedAt: Date.now(),
      duration: 1000, exitCode: 0,
    });

    const text = buildListMinionsText(tree, queue, subsessionManager);
    expect(text).toContain("mel");
    expect(text).toContain("Pending");
  });
});

describe("buildShowMinionText", () => {
  it("returns null for unknown target", () => {
    const tree = new AgentTree();
    const queue = new ResultQueue();

    const text = buildShowMinionText(tree, queue, "nope");
    expect(text).toBeNull();
  });

  it("returns string with name, status, and activity for known running minion", () => {
    const tree = new AgentTree();
    const queue = new ResultQueue();

    tree.add("a", "kevin", "analyze code");
    tree.updateActivity("a", "→ $ grep -r TODO");

    const text = buildShowMinionText(tree, queue, "kevin");
    expect(text).not.toBeNull();
    expect(text).toContain("kevin");
    expect(text).toContain("running");
    expect(text).toContain("→ $ grep -r TODO");
  });

  it("resolves target by ID", () => {
    const tree = new AgentTree();
    const queue = new ResultQueue();

    tree.add("abc123", "kevin", "task");

    const text = buildShowMinionText(tree, queue, "abc123");
    expect(text).not.toBeNull();
    expect(text).toContain("abc123");
  });
});

// validateSteerTarget helper

describe("validateSteerTarget", () => {
  it("returns error when minion not found", () => {
    const tree = new AgentTree();
    const subsessionManager = createMockSubsessionManager();
    const result = validateSteerTarget(tree, subsessionManager, "nonexistent");
    expect(result.success).toBe(false);
    if (result.success === false) {
      expect(result.error).toContain("not found");
      expect(result.errorType).toBe("error");
    }
  });

  it("returns info error when minion exists but is not running", () => {
    const tree = new AgentTree();
    const subsessionManager = createMockSubsessionManager();
    tree.add("a", "kevin", "task");
    tree.updateStatus("a", "completed", 0);
    const result = validateSteerTarget(tree, subsessionManager, "kevin");
    expect(result.success).toBe(false);
    if (result.success === false) {
      expect(result.error).toContain("not running");
      expect(result.errorType).toBe("info");
    }
  });

  it("returns error when minion is running but has no active session", () => {
    const tree = new AgentTree();
    const subsessionManager = createMockSubsessionManager(); // empty sessions
    tree.add("a", "kevin", "task");
    const result = validateSteerTarget(tree, subsessionManager, "kevin");
    expect(result.success).toBe(false);
    if (result.success === false) {
      expect(result.error).toContain("No active session");
      expect(result.errorType).toBe("error");
    }
  });

  it("returns success with node and steer function when valid", () => {
    const tree = new AgentTree();
    const sessions = new Map<string, any>();
    sessions.set("a", mockSession());
    const subsessionManager = createMockSubsessionManager(sessions);
    tree.add("a", "kevin", "task");
    const result = validateSteerTarget(tree, subsessionManager, "kevin");
    expect(result.success).toBe(true);
    if (result.success === true) {
      expect(result.node.name).toBe("kevin");
      expect(typeof result.steer).toBe("function");
    }
  });

  it("resolves target by ID as well as name", () => {
    const tree = new AgentTree();
    const sessions = new Map<string, any>();
    sessions.set("abc123", mockSession());
    const subsessionManager = createMockSubsessionManager(sessions);
    tree.add("abc123", "kevin", "task");
    const result = validateSteerTarget(tree, subsessionManager, "abc123");
    expect(result.success).toBe(true);
    if (result.success === true) expect(result.node.id).toBe("abc123");
  });
});

// executeSteering helper

describe("executeSteering", () => {
  it("wraps message in USER STEER context and calls steer", async () => {
    const steer = vi.fn().mockResolvedValue(undefined);
    const node = { id: "a", name: "kevin" } as any;
    const result = await executeSteering(node, steer, "restart task");
    expect(steer).toHaveBeenCalledWith(expect.stringContaining("[USER STEER]"));
    expect(steer).toHaveBeenCalledWith(expect.stringContaining("restart task"));
    expect(result).toContain("Steered kevin (a)");
    expect(result).toContain("restart task");
  });
});
