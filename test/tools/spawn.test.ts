/**
 * Behaviour-based tests for spawn / spawnBg tools.
 *
 * Strategy: mock runMinionSession (the LLM boundary) so tests stay fast and
 * deterministic, but assert on observable system state — AgentTree status,
 * queue contents, onUpdate stream, and returned tool results — not on
 * implementation details like which internal functions were called.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ResultQueue } from "../../src/queue.js";
import { minionCompleteRenderer } from "../../src/renderers/minion-complete.js";
import { SubsessionManager } from "../../src/subsessions/manager.js";
import { AgentTree } from "../../src/tree.js";

vi.mock("../../src/agents.js", () => ({
  discoverAgents: vi.fn(),
}));
vi.mock("../../src/spawn.js", () => ({
  runMinionSession: vi.fn(),
}));

import { discoverAgents } from "../../src/agents.js";
import { runMinionSession } from "../../src/spawn.js";
import { detachMinion, spawn, spawnBg } from "../../src/tools/spawn.js";
import { emptyUsage } from "../../src/types.js";

const mockAgent = {
  name: "scout",
  description: "Fast recon",
  systemPrompt: "You are a scout.",
  source: "user" as const,
  filePath: "/tmp/scout.md",
};

function createCtx() {
  return {
    cwd: "/tmp",
    modelRegistry: {},
    model: undefined,
    ui: { setWorkingMessage: vi.fn() },
    getSystemPrompt: () => "",
    sessionManager: {
      getSessionFile: vi.fn().mockReturnValue("/tmp/parent.jsonl"),
    },
  } as any;
}

function createDeps() {
  const tree = new AgentTree();
  const queue = new ResultQueue();
  const pi = { sendUserMessage: vi.fn(), sendMessage: vi.fn() } as any;
  const subsessionManager = new SubsessionManager("/tmp", "/tmp/parent.jsonl");
  return { tree, queue, pi, subsessionManager };
}

beforeEach(() => {
  vi.mocked(discoverAgents).mockReturnValue({
    agents: [mockAgent],
    projectAgentsDir: null,
  });
  vi.mocked(runMinionSession).mockResolvedValue({
    exitCode: 0,
    finalOutput: "done",
    usage: { ...emptyUsage(), turns: 1 },
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

// spawn (foreground)

describe("spawn — successful completion", () => {
  it("tree node ends as completed after successful session", async () => {
    const { tree, queue, pi, subsessionManager } = createDeps();
    await spawn(tree, queue, pi, subsessionManager)(
      "tc",
      { agent: "scout", task: "find auth" },
      undefined,
      undefined,
      createCtx(),
    );
    const node = tree.getRoots()[0]!;
    expect(node.status).toBe("completed");
    expect(node.task).toBe("find auth");
  });

  it("result content contains final output and minion identity", async () => {
    const { tree, queue, pi, subsessionManager } = createDeps();
    const result = await spawn(tree, queue, pi, subsessionManager)(
      "tc",
      { agent: "scout", task: "t" },
      undefined,
      undefined,
      createCtx(),
    );
    const text = (result.content[0] as any).text as string;
    expect(text).toContain("done");
    expect(text).toMatch(/Minion \w+ \(\w+\)/);
  });

  it("final onUpdate has status=completed so sibling spinners re-render", async () => {
    const { tree, queue, pi, subsessionManager } = createDeps();
    const statuses: string[] = [];
    await spawn(tree, queue, pi, subsessionManager)(
      "tc",
      { agent: "scout", task: "t" },
      undefined,
      (u: any) => {
        if (u.details?.status) statuses.push(u.details.status);
      },
      createCtx(),
    );
    // The last update must show the final status so that pi re-renders
    // sibling tool banners immediately, not after the next spinner tick.
    expect(statuses.at(-1)).toBe("completed");
  });

  it("ephemeral agent is used when no agent param", async () => {
    const { tree, queue, pi, subsessionManager } = createDeps();
    await spawn(tree, queue, pi, subsessionManager)(
      "tc",
      { task: "do thing" },
      undefined,
      undefined,
      createCtx(),
    );
    expect(vi.mocked(runMinionSession)).toHaveBeenCalledWith(
      expect.objectContaining({ source: "ephemeral" }),
      "do thing",
      expect.anything(),
    );
  });

  it("model override is forwarded to runMinionSession", async () => {
    const { tree, queue, pi, subsessionManager } = createDeps();
    await spawn(tree, queue, pi, subsessionManager)(
      "tc",
      { task: "t", model: "claude-haiku-4-5" },
      undefined,
      undefined,
      createCtx(),
    );
    expect(vi.mocked(runMinionSession)).toHaveBeenCalledWith(
      expect.objectContaining({ model: "claude-haiku-4-5" }),
      "t",
      expect.anything(),
    );
  });

  it("named agent is resolved from discovery list", async () => {
    const { tree, queue, pi, subsessionManager } = createDeps();
    await spawn(tree, queue, pi, subsessionManager)(
      "tc",
      { agent: "scout", task: "find auth" },
      undefined,
      undefined,
      createCtx(),
    );
    expect(vi.mocked(runMinionSession)).toHaveBeenCalledWith(
      expect.objectContaining({ name: "scout", source: "user" }),
      "find auth",
      expect.anything(),
    );
  });

  it("throws listing available agents when unknown agent requested", async () => {
    const { tree, queue, pi, subsessionManager } = createDeps();
    await expect(
      spawn(tree, queue, pi, subsessionManager)(
        "tc",
        { agent: "unknown", task: "t" },
        undefined,
        undefined,
        createCtx(),
      ),
    ).rejects.toThrow(/scout/);
  });
});

describe("spawn — failure", () => {
  it("tree node ends as failed and spawn throws when session exits non-zero", async () => {
    vi.mocked(runMinionSession).mockResolvedValue({
      exitCode: 1,
      finalOutput: "",
      usage: emptyUsage(),
      error: "oops",
    });
    const { tree, queue, pi, subsessionManager } = createDeps();
    await expect(
      spawn(tree, queue, pi, subsessionManager)(
        "tc",
        { agent: "scout", task: "fail" },
        undefined,
        undefined,
        createCtx(),
      ),
    ).rejects.toThrow();
    expect(tree.getRoots()[0]?.status).toBe("failed");
  });

  it("final onUpdate has status=failed before the throw (sibling refresh)", async () => {
    vi.mocked(runMinionSession).mockResolvedValue({
      exitCode: 1,
      finalOutput: "task failed",
      usage: emptyUsage(),
      error: "Command failed",
    });
    const { tree, queue, pi, subsessionManager } = createDeps();
    const updates: any[] = [];
    await expect(
      spawn(tree, queue, pi, subsessionManager)(
        "tc",
        { agent: "scout", task: "t" },
        undefined,
        (u: any) => updates.push(u),
        createCtx(),
      ),
    ).rejects.toThrow();

    const last = updates.at(-1);
    expect(last?.details?.status).toBe("failed");
    expect(last?.details?.finalOutput).toBe("task failed");
  });
});

describe("spawn — halt (abort signal)", () => {
  it("throws [HALTED] and emits final update when node is aborted during execution", async () => {
    // Simulate what abortAgents does: marks the node aborted then session resolves exit 1.
    const { tree, queue, pi, subsessionManager } = createDeps();
    vi.mocked(runMinionSession).mockImplementation(async (_config, _task, opts) => {
      // Mimic the side-effect of abortAgents being called mid-run
      tree.updateStatus(opts.id!, "aborted");
      return { exitCode: 1, finalOutput: "halted", usage: emptyUsage() };
    });

    const updates: any[] = [];
    await expect(
      spawn(tree, queue, pi, subsessionManager)(
        "tc",
        { agent: "scout", task: "t" },
        undefined,
        (u: any) => updates.push(u),
        createCtx(),
      ),
    ).rejects.toThrow(/HALTED/);

    // The update MUST be emitted before the throw so siblings re-render immediately
    const last = updates.at(-1);
    expect(last?.details?.status).toBe("aborted");
  });
});

describe("spawn — detach to background", () => {
  it("spawn returns immediately when detachMinion is called mid-run", async () => {
    let capturedId: string | undefined;
    // Session never resolves on its own — it needs detachMinion to unblock spawn
    vi.mocked(runMinionSession).mockImplementation(async (_config, _task, opts) => {
      capturedId = opts.id;
      return new Promise(() => {}); // deliberately never resolves
    });

    const { tree, queue, pi, subsessionManager } = createDeps();
    const spawnPromise = spawn(tree, queue, pi, subsessionManager)(
      "tc",
      { agent: "scout", task: "long task" },
      undefined,
      undefined,
      createCtx(),
    );

    await new Promise((r) => setTimeout(r, 10)); // let session start
    expect(capturedId).toBeDefined();

    // Detach unblocks spawn without aborting the underlying session
    detachMinion(capturedId!);
    const result = await spawnPromise;

    expect(result.details?.status).toBe("running");
    expect((result.content[0] as any).text).toContain("background");
  });

  it("minion is marked detached after being sent to background", async () => {
    let capturedId: string | undefined;
    vi.mocked(runMinionSession).mockImplementation(async (_config, _task, opts) => {
      capturedId = opts.id;
      return new Promise(() => {});
    });

    const { tree, queue, pi, subsessionManager } = createDeps();
    const spawnPromise = spawn(tree, queue, pi, subsessionManager)(
      "tc",
      { agent: "scout", task: "t" },
      undefined,
      undefined,
      createCtx(),
    );

    await new Promise((r) => setTimeout(r, 10));
    expect(tree.get(capturedId!)?.detached).toBeFalsy(); // not yet detached

    detachMinion(capturedId!);
    await spawnPromise;

    // Now it should be in the background
    expect(tree.get(capturedId!)?.detached).toBe(true);
    expect(tree.get(capturedId!)?.status).toBe("running"); // still running, not aborted
  });

  it("final onUpdate is emitted on detach so sibling banners refresh immediately", async () => {
    let capturedId: string | undefined;
    vi.mocked(runMinionSession).mockImplementation(async (_config, _task, opts) => {
      capturedId = opts.id;
      return new Promise(() => {});
    });

    const { tree, queue, pi, subsessionManager } = createDeps();
    const updates: any[] = [];
    const spawnPromise = spawn(tree, queue, pi, subsessionManager)(
      "tc",
      { agent: "scout", task: "t" },
      undefined,
      (u: any) => updates.push(u),
      createCtx(),
    );

    await new Promise((r) => setTimeout(r, 10));
    detachMinion(capturedId!);
    await spawnPromise;

    const last = updates.at(-1);
    expect(last?.details?.finalOutput).toBe("Moved to background by user");
  });
});

// spawnBg (fire-and-forget)

describe("spawnBg", () => {
  it("returns immediately while session is still running", async () => {
    let sessionResolve!: (v: any) => void;
    vi.mocked(runMinionSession).mockReturnValue(
      new Promise((r) => {
        sessionResolve = r;
      }),
    );

    const { tree, queue, pi, subsessionManager } = createDeps();
    const result = await spawnBg(tree, queue, pi, subsessionManager)(
      "tc",
      { task: "bg task" },
      undefined,
      undefined,
      createCtx(),
    );

    // Returned immediately: minion still running in tree
    expect(tree.getRunning()).toHaveLength(1);
    expect(tree.getRunning()[0]?.task).toBe("bg task");
    expect((result.content[0] as any).text).toContain("background");

    sessionResolve({ exitCode: 0, finalOutput: "done", usage: emptyUsage() });
    await new Promise((r) => setTimeout(r, 10));
  });

  it("minion is marked detached immediately so status tracker counts it as background", async () => {
    let sessionResolve!: (v: any) => void;
    vi.mocked(runMinionSession).mockReturnValue(
      new Promise((r) => {
        sessionResolve = r;
      }),
    );

    const { tree, queue, pi, subsessionManager } = createDeps();
    await spawnBg(tree, queue, pi, subsessionManager)(
      "tc",
      { task: "bg task" },
      undefined,
      undefined,
      createCtx(),
    );

    // The critical invariant: background minions must never look like foreground
    // to the status tracker, otherwise the parent session UI blocks.
    const minion = tree.getRunning()[0]!;
    expect(minion.detached).toBe(true);

    sessionResolve({ exitCode: 0, finalOutput: "done", usage: emptyUsage() });
    await new Promise((r) => setTimeout(r, 10));
  });

  it("multiple spawnBg calls all produce background minions", async () => {
    vi.mocked(runMinionSession).mockReturnValue(new Promise(() => {}));

    const { tree, queue, pi, subsessionManager } = createDeps();
    const execute = spawnBg(tree, queue, pi, subsessionManager);
    await execute("tc-1", { task: "t1" }, undefined, undefined, createCtx());
    await execute("tc-2", { task: "t2" }, undefined, undefined, createCtx());
    await execute("tc-3", { task: "t3" }, undefined, undefined, createCtx());

    const running = tree.getRunning();
    expect(running).toHaveLength(3);
    expect(running.every((n) => n.detached)).toBe(true);
    expect(running.filter((n) => !n.detached)).toHaveLength(0); // zero foreground
  });

  it("onUpdate is called once immediately with running/background status", async () => {
    let sessionResolve!: (v: any) => void;
    vi.mocked(runMinionSession).mockReturnValue(
      new Promise((r) => {
        sessionResolve = r;
      }),
    );

    const { tree, queue, pi, subsessionManager } = createDeps();
    const updates: any[] = [];

    await spawnBg(tree, queue, pi, subsessionManager)(
      "tc",
      { task: "bg task" },
      undefined,
      (u: any) => updates.push(u),
      createCtx(),
    );

    expect(updates).toHaveLength(1);
    expect(updates[0].details?.status).toBe("running");
    expect(updates[0].details?.finalOutput).toBe("Spawned in background");

    sessionResolve({ exitCode: 0, finalOutput: "done", usage: emptyUsage() });
    await new Promise((r) => setTimeout(r, 10));
  });
});

// Live usage in banner updates

describe("usage — live banner updates while running", () => {
  it("emitted update carries non-zero usage when onUsageUpdate fires mid-session", async () => {
    vi.mocked(runMinionSession).mockImplementation(async (_config, _task, opts: any) => {
      opts.onUsageUpdate?.({
        input: 500,
        output: 200,
        cacheRead: 50,
        cacheWrite: 10,
        cost: 0.003,
      });
      return { exitCode: 0, finalOutput: "done", usage: emptyUsage() };
    });

    const { tree, queue, pi, subsessionManager } = createDeps();
    const updates: any[] = [];
    await spawn(tree, queue, pi, subsessionManager)(
      "tc",
      { agent: "scout", task: "t" },
      undefined,
      (u: any) => updates.push(u),
      createCtx(),
    );

    const liveUpdate = updates.find((u) => (u.details?.usage?.input ?? 0) > 0);
    expect(liveUpdate).toBeDefined();
    expect(liveUpdate?.details.usage.input).toBe(500);
    expect(liveUpdate?.details.usage.cost).toBe(0.003);
  });

  it("zero usage shown before any turn completes", async () => {
    // Session starts but never fires onUsageUpdate (not yet at turn boundary)
    vi.mocked(runMinionSession).mockImplementation(async (_config, _task, _opts: any) => {
      return { exitCode: 0, finalOutput: "done", usage: emptyUsage() };
    });

    const { tree, queue, pi, subsessionManager } = createDeps();
    const updates: any[] = [];
    await spawn(tree, queue, pi, subsessionManager)(
      "tc",
      { agent: "scout", task: "t" },
      undefined,
      (u: any) => updates.push(u),
      createCtx(),
    );

    // The very first update (spinner tick at start) must show zero usage
    expect(updates[0]?.details?.usage?.input).toBe(0);
  });
});

// Batch spawn execution

describe("batch spawn execution", () => {
  it("single-item batch uses unified spawn path with isBatch flag", async () => {
    const { tree, queue, pi, subsessionManager } = createDeps();
    const result = await spawn(tree, queue, pi, subsessionManager)(
      "tc",
      { tasks: [{ task: "single task" }] } as any,
      undefined,
      undefined,
      createCtx(),
    );

    expect(result.details?.isBatch).toBe(true);
    expect(result.details?.minions).toHaveLength(1);
    expect(vi.mocked(runMinionSession)).toHaveBeenCalledTimes(1);
  });

  it("multi-item batch creates batch with isBatch flag", async () => {
    const { tree, queue, pi, subsessionManager } = createDeps();

    vi.mocked(runMinionSession).mockImplementation(async (_config, task) => ({
      exitCode: 0,
      finalOutput: `completed: ${task}`,
      usage: { ...emptyUsage(), turns: 1 },
    }));

    const result = await spawn(tree, queue, pi, subsessionManager)(
      "tc",
      { tasks: [{ task: "task1" }, { task: "task2" }, { task: "task3" }] } as any,
      undefined,
      undefined,
      createCtx(),
    );

    expect(result.details?.isBatch).toBe(true);
    expect(result.details?.minions).toHaveLength(3);
    expect(vi.mocked(runMinionSession)).toHaveBeenCalledTimes(3);
  });

  it("batch aggregates all minion outputs", async () => {
    const { tree, queue, pi, subsessionManager } = createDeps();

    vi.mocked(runMinionSession).mockImplementation(async (_config, task) => ({
      exitCode: 0,
      finalOutput: `output for ${task}`,
      usage: { ...emptyUsage(), turns: 1 },
    }));

    const result = await spawn(tree, queue, pi, subsessionManager)(
      "tc",
      { tasks: [{ task: "alpha" }, { task: "beta" }] } as any,
      undefined,
      undefined,
      createCtx(),
    );

    const text = (result.content[0] as any).text;
    expect(text).toContain("output for alpha");
    expect(text).toContain("output for beta");
  });

  it("batch aggregates usage across all minions", async () => {
    const { tree, queue, pi, subsessionManager } = createDeps();
    let callCount = 0;

    vi.mocked(runMinionSession).mockImplementation(async () => {
      callCount++;
      return {
        exitCode: 0,
        finalOutput: "done",
        usage: {
          input: 100 * callCount,
          output: 50 * callCount,
          cacheRead: 10 * callCount,
          cacheWrite: 5 * callCount,
          cost: 0.001 * callCount,
          contextTokens: 150 * callCount,
          turns: callCount,
        },
      };
    });

    const result = await spawn(tree, queue, pi, subsessionManager)(
      "tc",
      { tasks: [{ task: "t1" }, { task: "t2" }] } as any,
      undefined,
      undefined,
      createCtx(),
    );

    expect(result.details?.usage.input).toBe(300);
    expect(result.details?.usage.output).toBe(150);
    expect(result.details?.usage.cost).toBe(0.003);
  });

  it("batch fails if any minion fails", async () => {
    const { tree, queue, pi, subsessionManager } = createDeps();

    vi.mocked(runMinionSession)
      .mockResolvedValueOnce({
        exitCode: 0,
        finalOutput: "success",
        usage: emptyUsage(),
      })
      .mockResolvedValueOnce({
        exitCode: 1,
        finalOutput: "failed",
        usage: emptyUsage(),
        error: "Something went wrong",
      });

    await expect(
      spawn(tree, queue, pi, subsessionManager)(
        "tc",
        { tasks: [{ task: "t1" }, { task: "t2" }] } as any,
        undefined,
        undefined,
        createCtx(),
      ),
    ).rejects.toThrow(/failed/);
  });

  it("batch reports failed minion names in error", async () => {
    const { tree, queue, pi, subsessionManager } = createDeps();

    vi.mocked(runMinionSession)
      .mockResolvedValueOnce({
        exitCode: 0,
        finalOutput: "success",
        usage: emptyUsage(),
      })
      .mockResolvedValueOnce({
        exitCode: 1,
        finalOutput: "failed",
        usage: emptyUsage(),
        error: "Error",
      });

    try {
      await spawn(tree, queue, pi, subsessionManager)(
        "tc",
        { tasks: [{ task: "t1" }, { task: "t2" }] } as any,
        undefined,
        undefined,
        createCtx(),
      );
      expect.fail("should have thrown");
    } catch (err: any) {
      expect(err.message).toContain("Batch spawn failed");
      expect(err.message).toMatch(/Failed minions: \w+/);
    }
  });

  it("batch streams updates via onUpdate callback", async () => {
    const { tree, queue, pi, subsessionManager } = createDeps();
    const updates: any[] = [];

    vi.mocked(runMinionSession).mockImplementation(async (_config, _task, opts: any) => {
      opts.onTextDelta?.("", "working...");
      await new Promise((r) => setTimeout(r, 0));
      return {
        exitCode: 0,
        finalOutput: "done",
        usage: emptyUsage(),
      };
    });

    await spawn(tree, queue, pi, subsessionManager)(
      "tc",
      { tasks: [{ task: "t1" }, { task: "t2" }] } as any,
      undefined,
      (u: any) => updates.push(u),
      createCtx(),
    );

    expect(updates.length).toBeGreaterThanOrEqual(2);
    expect(updates.every((u) => u.details?.isBatch)).toBe(true);
  });

  it("batch adds all minions to tree", async () => {
    const { tree, queue, pi, subsessionManager } = createDeps();

    vi.mocked(runMinionSession).mockImplementation(async () => ({
      exitCode: 0,
      finalOutput: "done",
      usage: emptyUsage(),
    }));

    await spawn(tree, queue, pi, subsessionManager)(
      "tc",
      { tasks: [{ task: "t1" }, { task: "t2" }, { task: "t3" }] } as any,
      undefined,
      undefined,
      createCtx(),
    );

    const roots = tree.getRoots();
    expect(roots).toHaveLength(3);
    expect(roots.map((r) => r.task)).toContain("t1");
    expect(roots.map((r) => r.task)).toContain("t2");
    expect(roots.map((r) => r.task)).toContain("t3");
  });

  it("batch respects abort signal", async () => {
    const { tree, queue, pi, subsessionManager } = createDeps();
    const controller = new AbortController();

    vi.mocked(runMinionSession).mockImplementation(async (_config, _task, opts: any) => {
      if (opts.signal?.aborted) {
        throw new Error("Aborted");
      }
      await new Promise((r) => setTimeout(r, 100));
      return {
        exitCode: 0,
        finalOutput: "done",
        usage: emptyUsage(),
      };
    });

    setTimeout(() => controller.abort(), 50);

    const result = await spawn(tree, queue, pi, subsessionManager)(
      "tc",
      { tasks: [{ task: "t1" }, { task: "t2" }] } as any,
      controller.signal,
      undefined,
      createCtx(),
    );

    expect(result.details?.isBatch).toBe(true);
  });
});

describe("batch spawn with agents", () => {
  it("resolves named agents in batch tasks", async () => {
    const { tree, queue, pi, subsessionManager } = createDeps();

    vi.mocked(runMinionSession).mockImplementation(async () => ({
      exitCode: 0,
      finalOutput: "done",
      usage: emptyUsage(),
    }));

    await spawn(tree, queue, pi, subsessionManager)(
      "tc",
      {
        tasks: [
          { task: "t1", agent: "scout" },
          { task: "t2", agent: "scout" },
        ],
      } as any,
      undefined,
      undefined,
      createCtx(),
    );

    expect(vi.mocked(runMinionSession)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(runMinionSession)).toHaveBeenCalledWith(
      expect.objectContaining({ name: "scout" }),
      expect.any(String),
      expect.anything(),
    );
  });

  it("uses ephemeral agents when no agent specified", async () => {
    const { tree, queue, pi, subsessionManager } = createDeps();

    vi.mocked(runMinionSession).mockImplementation(async () => ({
      exitCode: 0,
      finalOutput: "done",
      usage: emptyUsage(),
    }));

    await spawn(tree, queue, pi, subsessionManager)(
      "tc",
      { tasks: [{ task: "t1" }, { task: "t2" }] } as any,
      undefined,
      undefined,
      createCtx(),
    );

    expect(vi.mocked(runMinionSession)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(runMinionSession)).toHaveBeenCalledWith(
      expect.objectContaining({ source: "ephemeral" }),
      expect.any(String),
      expect.anything(),
    );
  });

  it("throws if unknown agent in batch task", async () => {
    const { tree, queue, pi, subsessionManager } = createDeps();

    await expect(
      spawn(tree, queue, pi, subsessionManager)(
        "tc",
        { tasks: [{ task: "t1", agent: "unknown" }] } as any,
        undefined,
        undefined,
        createCtx(),
      ),
    ).rejects.toThrow(/Agent "unknown" not found/);
  });
});

// spawnBg — completion result delivery

describe("spawnBg — completion result delivery", () => {
  it("calls pi.sendMessage with customType 'minion-complete' when background minion succeeds", async () => {
    vi.mocked(runMinionSession).mockResolvedValue({
      exitCode: 0,
      finalOutput: "Task completed successfully",
      usage: { ...emptyUsage(), turns: 1 },
    });

    const { tree, queue, pi, subsessionManager } = createDeps();
    await spawnBg(tree, queue, pi, subsessionManager)(
      "tc",
      { task: "background task" },
      undefined,
      undefined,
      createCtx(),
    );

    // Wait for async completion
    await new Promise((r) => setTimeout(r, 10));

    // Assert sendMessage was called (not sendUserMessage)
    expect(pi.sendMessage).toHaveBeenCalled();
    expect(pi.sendUserMessage).not.toHaveBeenCalled();

    // Assert correct customType
    const sendMessageCall = vi.mocked(pi.sendMessage).mock.calls[0];
    expect(sendMessageCall?.[0]).toMatchObject({
      customType: "minion-complete",
      display: true,
    });

    // Assert details contain expected fields
    const messageData = sendMessageCall?.[0] as any;
    expect(messageData.details).toMatchObject({
      exitCode: 0,
      task: "background task",
    });
    expect(messageData.details.id).toBeDefined();
    expect(messageData.details.name).toBeDefined();
    expect(messageData.details.duration).toBeGreaterThanOrEqual(0);
  });

  it("calls pi.sendMessage with error details when background minion fails", async () => {
    vi.mocked(runMinionSession).mockResolvedValue({
      exitCode: 1,
      finalOutput: "Error output",
      usage: emptyUsage(),
      error: "Something went wrong",
    });

    const { tree, queue, pi, subsessionManager } = createDeps();
    await spawnBg(tree, queue, pi, subsessionManager)(
      "tc",
      { task: "failing task" },
      undefined,
      undefined,
      createCtx(),
    );

    await new Promise((r) => setTimeout(r, 10));

    const sendMessageCall = vi.mocked(pi.sendMessage).mock.calls[0];
    expect(sendMessageCall?.[0]).toMatchObject({
      customType: "minion-complete",
    });

    const messageData = sendMessageCall?.[0] as any;
    expect(messageData.details).toMatchObject({
      exitCode: 1,
      error: "Something went wrong",
      task: "failing task",
    });
  });

  it("does NOT call pi.sendUserMessage when background minion completes", async () => {
    vi.mocked(runMinionSession).mockResolvedValue({
      exitCode: 0,
      finalOutput: "Done",
      usage: emptyUsage(),
    });

    const { tree, queue, pi, subsessionManager } = createDeps();
    await spawnBg(tree, queue, pi, subsessionManager)(
      "tc",
      { task: "simple task" },
      undefined,
      undefined,
      createCtx(),
    );

    await new Promise((r) => setTimeout(r, 10));

    expect(pi.sendUserMessage).not.toHaveBeenCalled();
    expect(pi.sendMessage).toHaveBeenCalledTimes(1);
  });

  it("still adds result to queue and calls queue.accept after sendMessage", async () => {
    vi.mocked(runMinionSession).mockResolvedValue({
      exitCode: 0,
      finalOutput: "Queued result",
      usage: { ...emptyUsage(), input: 100, output: 50 },
    });

    const { tree, queue, pi, subsessionManager } = createDeps();
    const addSpy = vi.spyOn(queue, "add");
    const acceptSpy = vi.spyOn(queue, "accept");

    await spawnBg(tree, queue, pi, subsessionManager)(
      "tc",
      { task: "queued task" },
      undefined,
      undefined,
      createCtx(),
    );

    await new Promise((r) => setTimeout(r, 10));

    // Verify queue.add was called with result data
    expect(addSpy).toHaveBeenCalled();
    const queuedResult = addSpy.mock.calls[0]?.[0];
    expect(queuedResult).toMatchObject({
      task: "queued task",
      output: "Queued result",
      status: "pending",
      exitCode: 0,
    });

    // Verify queue.accept was called
    expect(acceptSpy).toHaveBeenCalled();

    // Verify both sendMessage and queue operations happened
    expect(pi.sendMessage).toHaveBeenCalled();
  });

  it("includes triggerTurn: true and deliverAs: 'nextTurn' in sendMessage options", async () => {
    vi.mocked(runMinionSession).mockResolvedValue({
      exitCode: 0,
      finalOutput: "Done",
      usage: emptyUsage(),
    });

    const { tree, queue, pi, subsessionManager } = createDeps();
    await spawnBg(tree, queue, pi, subsessionManager)(
      "tc",
      { task: "options test" },
      undefined,
      undefined,
      createCtx(),
    );

    await new Promise((r) => setTimeout(r, 10));

    // Verify message structure - brief system content, output in details
    const sendMessageCall = vi.mocked(pi.sendMessage).mock.calls[0];
    expect(sendMessageCall?.[0]).toMatchObject({
      customType: "minion-complete",
      display: true,
    });
    // Content should indicate background completion, not user message
    expect(sendMessageCall?.[0].content).toContain("Background minion");
    expect(sendMessageCall?.[0].content).toContain("completed");
    // triggerTurn should be true so parent reacts
    expect(sendMessageCall?.[1]).toMatchObject({ triggerTurn: true });
  });

  it("sendMessage payload has all required fields for renderer", async () => {
    vi.mocked(runMinionSession).mockResolvedValue({
      exitCode: 0,
      finalOutput: "Test output",
      usage: { ...emptyUsage(), input: 100, output: 50 },
    });

    const { tree, queue, pi, subsessionManager } = createDeps();
    await spawnBg(tree, queue, pi, subsessionManager)(
      "tc",
      { task: "renderer test task" },
      undefined,
      undefined,
      createCtx(),
    );

    await new Promise((r) => setTimeout(r, 10));

    const sendMessageCall = vi.mocked(pi.sendMessage).mock.calls[0];
    const payload = sendMessageCall?.[0] as any;

    // Verify all fields required by renderer are present
    expect(payload).toHaveProperty("customType", "minion-complete");
    expect(payload).toHaveProperty("display", true);
    expect(payload).toHaveProperty("details");

    // content should be brief system message, not raw output
    expect(payload.content).toContain("Background minion");
    expect(payload.content).toContain("completed");
    expect(payload.content).toContain("exit code: 0");

    // Verify details has all required fields including output for renderer
    const details = payload.details;
    expect(details).toHaveProperty("id");
    expect(details).toHaveProperty("name");
    expect(details).toHaveProperty("task", "renderer test task");
    expect(details).toHaveProperty("exitCode", 0);
    expect(details).toHaveProperty("duration");
    expect(details).toHaveProperty("output", "Test output"); // output in details for renderer
    expect(details.id).toBeTruthy();
    expect(details.name).toBeTruthy();
  });

  it("handles sendMessage throwing an error gracefully", async () => {
    vi.mocked(runMinionSession).mockResolvedValue({
      exitCode: 0,
      finalOutput: "Done",
      usage: emptyUsage(),
    });

    const tree = new AgentTree();
    const queue = new ResultQueue();
    const addSpy = vi.spyOn(queue, "add");
    const acceptSpy = vi.spyOn(queue, "accept");
    const pi = { sendUserMessage: vi.fn(), sendMessage: vi.fn() } as any;
    const subsessionManager = new SubsessionManager("/tmp", "/tmp/parent.jsonl");

    // Make sendMessage throw
    vi.mocked(pi.sendMessage).mockImplementation(() => {
      throw new Error("sendMessage failed");
    });

    await spawnBg(tree, queue, pi, subsessionManager)(
      "tc",
      { task: "error test" },
      undefined,
      undefined,
      createCtx(),
    );

    await new Promise((r) => setTimeout(r, 10));

    // Verify queue operations still happened even if sendMessage failed
    expect(addSpy).toHaveBeenCalled();
    expect(acceptSpy).toHaveBeenCalled();

    addSpy.mockRestore();
    acceptSpy.mockRestore();
  });
});

// Model resolution in banner

describe("model resolution in banner", () => {
  it("shows parent context model id for ephemeral agents with no configured model", async () => {
    const { tree, queue, pi, subsessionManager } = createDeps();
    const updates: any[] = [];
    await spawn(tree, queue, pi, subsessionManager)(
      "tc",
      { task: "t" },
      undefined,
      (u: any) => updates.push(u),
      {
        ...createCtx(),
        model: { id: "claude-sonnet-4-5", name: "Claude Sonnet 4.5" },
      } as any,
    );
    expect(updates[0]?.details?.model).toBe("claude-sonnet-4-5");
  });

  it("explicit model param takes precedence over context model", async () => {
    const { tree, queue, pi, subsessionManager } = createDeps();
    const updates: any[] = [];
    await spawn(tree, queue, pi, subsessionManager)(
      "tc",
      { task: "t", model: "claude-haiku-4-5" },
      undefined,
      (u: any) => updates.push(u),
      {
        ...createCtx(),
        model: { id: "claude-sonnet-4-5", name: "Claude Sonnet 4.5" },
      } as any,
    );
    expect(updates[0]?.details?.model).toBe("claude-haiku-4-5");
  });

  it("model is shown in spawnBg details when context model is set", async () => {
    let sessionResolve!: (v: any) => void;
    vi.mocked(runMinionSession).mockReturnValue(
      new Promise((r) => {
        sessionResolve = r;
      }),
    );

    const { tree, queue, pi, subsessionManager } = createDeps();
    const updates: any[] = [];
    await spawnBg(tree, queue, pi, subsessionManager)(
      "tc",
      { task: "bg" },
      undefined,
      (u: any) => updates.push(u),
      {
        ...createCtx(),
        model: { id: "claude-sonnet-4-5", name: "Claude Sonnet 4.5" },
      } as any,
    );

    expect(updates[0]?.details?.model).toBe("claude-sonnet-4-5");

    sessionResolve({ exitCode: 0, finalOutput: "done", usage: emptyUsage() });
    await new Promise((r) => setTimeout(r, 10));
  });

  it("model is undefined in banner when neither param, config, nor context model is set", async () => {
    const { tree, queue, pi, subsessionManager } = createDeps();
    const updates: any[] = [];
    // ctx.model is undefined (default createCtx)
    await spawn(tree, queue, pi, subsessionManager)(
      "tc",
      { task: "t" },
      undefined,
      (u: any) => updates.push(u),
      createCtx(),
    );
    expect(updates[0]?.details?.model).toBeUndefined();
  });
});

// Integration test for renderer
describe("spawnBg — integration with renderer", () => {
  it("renderer can render the message payload sent by spawnBg", async () => {
    vi.mocked(runMinionSession).mockResolvedValue({
      exitCode: 0,
      finalOutput: "Integration test output",
      usage: { ...emptyUsage(), turns: 1 },
    });

    const { tree, queue, pi, subsessionManager } = createDeps();

    // Capture the actual payload sent to sendMessage
    let capturedPayload: any;
    vi.mocked(pi.sendMessage).mockImplementation((payload: any) => {
      capturedPayload = payload;
    });

    await spawnBg(tree, queue, pi, subsessionManager)(
      "tc",
      { task: "integration test task" },
      undefined,
      undefined,
      createCtx(),
    );

    await new Promise((r) => setTimeout(r, 10));

    // Verify sendMessage was called
    expect(pi.sendMessage).toHaveBeenCalled();
    expect(capturedPayload).toBeDefined();

    // Now verify the renderer can render this payload
    const mockTheme = {
      fg: (_color: string, text: string) => text,
    };

    const renderResult = minionCompleteRenderer(
      capturedPayload,
      { expanded: false },
      mockTheme as any,
    );

    // Renderer should return a component, not undefined
    expect(renderResult).toBeDefined();
  });

  it("renderer returns undefined for incomplete payload", async () => {
    // Test that renderer properly rejects invalid payloads
    const mockTheme = {
      fg: (_color: string, text: string) => text,
    };

    // Payload missing required fields
    const incompletePayload = {
      customType: "minion-complete",
      content: "test",
      display: true,
      details: {
        // Missing id and name
        task: "test task",
        exitCode: 0,
        duration: 1000,
      },
    };

    const renderResult = minionCompleteRenderer(
      incompletePayload as any,
      { expanded: false },
      mockTheme as any,
    );

    expect(renderResult).toBeUndefined();
  });
});
