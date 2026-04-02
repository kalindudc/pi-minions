/**
 * Behaviour-based tests for spawn / spawnBg tools.
 *
 * Strategy: mock runMinionSession (the LLM boundary) so tests stay fast and
 * deterministic, but assert on observable system state — AgentTree status,
 * queue contents, onUpdate stream, and returned tool results — not on
 * implementation details like which internal functions were called.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { AgentTree } from "../../src/tree.js";
import { ResultQueue } from "../../src/queue.js";
import { SubsessionManager } from "../../src/subsessions/manager.js";

vi.mock("../../src/agents.js", () => ({
  discoverAgents: vi.fn(),
}));
vi.mock("../../src/spawn.js", () => ({
  runMinionSession: vi.fn(),
}));

import { discoverAgents } from "../../src/agents.js";
import { runMinionSession } from "../../src/spawn.js";
import { spawn, spawnBg, detachMinion } from "../../src/tools/spawn.js";
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
    sessionManager: { getSessionFile: vi.fn().mockReturnValue("/tmp/parent.jsonl") },
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
  vi.mocked(discoverAgents).mockReturnValue({ agents: [mockAgent], projectAgentsDir: null });
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
      "tc", { agent: "scout", task: "find auth" }, undefined, undefined, createCtx(),
    );
    const node = tree.getRoots()[0]!;
    expect(node.status).toBe("completed");
    expect(node.task).toBe("find auth");
  });

  it("result content contains final output and minion identity", async () => {
    const { tree, queue, pi, subsessionManager } = createDeps();
    const result = await spawn(tree, queue, pi, subsessionManager)(
      "tc", { agent: "scout", task: "t" }, undefined, undefined, createCtx(),
    );
    const text = (result.content[0] as any).text as string;
    expect(text).toContain("done");
    expect(text).toMatch(/Minion \w+ \(\w+\)/);
  });

  it("final onUpdate has status=completed so sibling spinners re-render", async () => {
    const { tree, queue, pi, subsessionManager } = createDeps();
    const statuses: string[] = [];
    await spawn(tree, queue, pi, subsessionManager)(
      "tc", { agent: "scout", task: "t" },
      undefined,
      (u: any) => { if (u.details?.status) statuses.push(u.details.status); },
      createCtx(),
    );
    // The last update must show the final status so that pi re-renders
    // sibling tool banners immediately, not after the next spinner tick.
    expect(statuses.at(-1)).toBe("completed");
  });

  it("ephemeral agent is used when no agent param", async () => {
    const { tree, queue, pi, subsessionManager } = createDeps();
    await spawn(tree, queue, pi, subsessionManager)(
      "tc", { task: "do thing" }, undefined, undefined, createCtx(),
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
      "tc", { task: "t", model: "claude-haiku-4-5" }, undefined, undefined, createCtx(),
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
      "tc", { agent: "scout", task: "find auth" }, undefined, undefined, createCtx(),
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
        "tc", { agent: "unknown", task: "t" }, undefined, undefined, createCtx(),
      ),
    ).rejects.toThrow(/scout/);
  });
});

describe("spawn — failure", () => {
  it("tree node ends as failed and spawn throws when session exits non-zero", async () => {
    vi.mocked(runMinionSession).mockResolvedValue({
      exitCode: 1, finalOutput: "", usage: emptyUsage(), error: "oops",
    });
    const { tree, queue, pi, subsessionManager } = createDeps();
    await expect(
      spawn(tree, queue, pi, subsessionManager)(
        "tc", { agent: "scout", task: "fail" }, undefined, undefined, createCtx(),
      ),
    ).rejects.toThrow();
    expect(tree.getRoots()[0]!.status).toBe("failed");
  });

  it("final onUpdate has status=failed before the throw (sibling refresh)", async () => {
    vi.mocked(runMinionSession).mockResolvedValue({
      exitCode: 1, finalOutput: "task failed", usage: emptyUsage(), error: "Command failed",
    });
    const { tree, queue, pi, subsessionManager } = createDeps();
    const updates: any[] = [];
    await expect(
      spawn(tree, queue, pi, subsessionManager)(
        "tc", { agent: "scout", task: "t" },
        undefined, (u: any) => updates.push(u), createCtx(),
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
        "tc", { agent: "scout", task: "t" },
        undefined, (u: any) => updates.push(u), createCtx(),
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
      "tc", { agent: "scout", task: "long task" }, undefined, undefined, createCtx(),
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
      "tc", { agent: "scout", task: "t" }, undefined, undefined, createCtx(),
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
      "tc", { agent: "scout", task: "t" },
      undefined, (u: any) => updates.push(u), createCtx(),
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
    vi.mocked(runMinionSession).mockReturnValue(new Promise((r) => { sessionResolve = r; }));

    const { tree, queue, pi, subsessionManager } = createDeps();
    const result = await spawnBg(tree, queue, pi, subsessionManager)(
      "tc", { task: "bg task" }, undefined, undefined, createCtx(),
    );

    // Returned immediately: minion still running in tree
    expect(tree.getRunning()).toHaveLength(1);
    expect(tree.getRunning()[0]!.task).toBe("bg task");
    expect((result.content[0] as any).text).toContain("background");

    sessionResolve({ exitCode: 0, finalOutput: "done", usage: emptyUsage() });
    await new Promise((r) => setTimeout(r, 10));
  });

  it("minion is marked detached immediately so status tracker counts it as background", async () => {
    let sessionResolve!: (v: any) => void;
    vi.mocked(runMinionSession).mockReturnValue(new Promise((r) => { sessionResolve = r; }));

    const { tree, queue, pi, subsessionManager } = createDeps();
    await spawnBg(tree, queue, pi, subsessionManager)(
      "tc", { task: "bg task" }, undefined, undefined, createCtx(),
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
    vi.mocked(runMinionSession).mockReturnValue(new Promise((r) => { sessionResolve = r; }));

    const { tree, queue, pi, subsessionManager } = createDeps();
    const updates: any[] = [];

    await spawnBg(tree, queue, pi, subsessionManager)(
      "tc", { task: "bg task" }, undefined, (u: any) => updates.push(u), createCtx(),
    );

    expect(updates).toHaveLength(1);
    expect(updates[0].details?.status).toBe("running");
    expect(updates[0].details?.finalOutput).toBe("Spawned in background");

    sessionResolve({ exitCode: 0, finalOutput: "done", usage: emptyUsage() });
    await new Promise((r) => setTimeout(r, 10));
  });
});
