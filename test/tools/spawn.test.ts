import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { AgentTree } from "../../src/tree.js";
import { ResultQueue } from "../../src/queue.js";

// Mock the modules that make external calls
vi.mock("../../src/agents.js", () => ({
  discoverAgents: vi.fn(),
}));
vi.mock("../../src/spawn.js", () => ({
  runMinionSession: vi.fn(),
}));

import { discoverAgents } from "../../src/agents.js";
import { runMinionSession } from "../../src/spawn.js";
import { spawn, spawnBg } from "../../src/tools/spawn.js";
import type { DetachHandle } from "../../src/tools/spawn.js";
import { emptyUsage } from "../../src/types.js";

const mockAgent = {
  name: "scout",
  description: "Fast recon",
  systemPrompt: "You are a scout.",
  source: "user" as const,
  filePath: "/tmp/scout.md",
};

function createCtx(cwd = "/tmp") {
  return { cwd, modelRegistry: {}, model: undefined, ui: { setWorkingMessage: vi.fn() } } as any;
}

function createDeps() {
  const tree = new AgentTree();
  const handles = new Map<string, AbortController>();
  const detachHandles = new Map<string, DetachHandle>();
  const queue = new ResultQueue();
  const pi = { sendMessage: vi.fn(), sendUserMessage: vi.fn(), getThinkingLevel: vi.fn().mockReturnValue("off") } as any;
  const sessions = new Map<string, any>();
  return { tree, handles, detachHandles, queue, pi, sessions };
}

beforeEach(() => {
  vi.mocked(discoverAgents).mockReturnValue({ agents: [mockAgent], projectAgentsDir: null });
  vi.mocked(runMinionSession).mockResolvedValue({
    exitCode: 0,
    finalOutput: "done",
    usage: { ...emptyUsage(), input: 100, output: 20, turns: 1 },
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("spawn", () => {
  it("throws for unknown agent and message lists available agents", async () => {
    const { tree, handles, detachHandles, queue, pi, sessions } = createDeps();
    const execute = spawn(tree, handles, detachHandles, queue, pi, sessions);

    await expect(
      execute("tc-1", { agent: "unknown-agent", task: "do thing" }, undefined, undefined, createCtx()),
    ).rejects.toThrow(/scout/);
  });

  it("adds node to tree with status running, then completed on success", async () => {
    const { tree, handles, detachHandles, queue, pi, sessions } = createDeps();
    const execute = spawn(tree, handles, detachHandles, queue, pi, sessions);

    await execute("tc-1", { agent: "scout", task: "find auth" }, undefined, undefined, createCtx());

    const roots = tree.getRoots();
    expect(roots).toHaveLength(1);
    expect(roots[0]!.status).toBe("completed");
    expect(roots[0]!.task).toBe("find auth");
  });

  it("sets node to failed and throws when session returns non-zero exit", async () => {
    vi.mocked(runMinionSession).mockResolvedValue({ exitCode: 1, finalOutput: "", usage: emptyUsage(), error: "exit 1" });
    const { tree, handles, detachHandles, queue, pi, sessions } = createDeps();
    const execute = spawn(tree, handles, detachHandles, queue, pi, sessions);

    await expect(
      execute("tc-1", { agent: "scout", task: "fail" }, undefined, undefined, createCtx()),
    ).rejects.toThrow();

    expect(tree.getRoots()[0]!.status).toBe("failed");
  });

  it("passes modelRegistry and parentModel to runMinionSession", async () => {
    const { tree, handles, detachHandles, queue, pi, sessions } = createDeps();
    const execute = spawn(tree, handles, detachHandles, queue, pi, sessions);
    const ctx = { cwd: "/tmp", modelRegistry: { find: vi.fn() }, model: { provider: "anthropic", id: "claude-haiku-4-5" }, ui: { setWorkingMessage: vi.fn() } } as any;

    await execute("tc-1", { agent: "scout", task: "t" }, undefined, undefined, ctx);

    expect(vi.mocked(runMinionSession)).toHaveBeenCalledWith(
      expect.anything(),
      "t",
      expect.objectContaining({
        modelRegistry: ctx.modelRegistry,
        parentModel: ctx.model,
        cwd: "/tmp",
      }),
    );
  });

  it("returns final output as content text", async () => {
    const { tree, handles, detachHandles, queue, pi, sessions } = createDeps();
    const execute = spawn(tree, handles, detachHandles, queue, pi, sessions);

    const result = await execute("tc-1", { agent: "scout", task: "t" }, undefined, undefined, createCtx());
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toBe("done");
  });

  it("spawns ephemeral agent when no agent param", async () => {
    const { tree, handles, detachHandles, queue, pi, sessions } = createDeps();
    const execute = spawn(tree, handles, detachHandles, queue, pi, sessions);

    const result = await execute(
      "tc-1", { task: "do the thing" }, undefined, undefined, createCtx(),
    );

    expect(vi.mocked(runMinionSession)).toHaveBeenCalledWith(
      expect.objectContaining({ source: "ephemeral" }),
      "do the thing",
      expect.anything(),
    );
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toBe("done");
  });

  it("ephemeral agent applies model override", async () => {
    const { tree, handles, detachHandles, queue, pi, sessions } = createDeps();
    const execute = spawn(tree, handles, detachHandles, queue, pi, sessions);

    await execute(
      "tc-1", { task: "t", model: "claude-haiku-4-5" }, undefined, undefined, createCtx(),
    );

    expect(vi.mocked(runMinionSession)).toHaveBeenCalledWith(
      expect.objectContaining({ model: "claude-haiku-4-5", source: "ephemeral" }),
      "t",
      expect.anything(),
    );
  });

  it("still discovers named agent when agent param provided", async () => {
    const { tree, handles, detachHandles, queue, pi, sessions } = createDeps();
    const execute = spawn(tree, handles, detachHandles, queue, pi, sessions);

    await execute(
      "tc-1", { agent: "scout", task: "find auth" }, undefined, undefined, createCtx(),
    );

    expect(vi.mocked(runMinionSession)).toHaveBeenCalledWith(
      expect.objectContaining({ name: "scout", source: "user" }),
      "find auth",
      expect.anything(),
    );
  });

  it("cleans up handle after execution", async () => {
    const { tree, handles, detachHandles, queue, pi, sessions } = createDeps();
    const execute = spawn(tree, handles, detachHandles, queue, pi, sessions);

    await execute("tc-1", { agent: "scout", task: "t" }, undefined, undefined, createCtx());

    expect(handles.size).toBe(0);
  });

  it("cleans up handle even on failure", async () => {
    vi.mocked(runMinionSession).mockResolvedValue({ exitCode: 1, finalOutput: "", usage: emptyUsage(), error: "fail" });
    const { tree, handles, detachHandles, queue, pi, sessions } = createDeps();
    const execute = spawn(tree, handles, detachHandles, queue, pi, sessions);

    await expect(
      execute("tc-1", { agent: "scout", task: "t" }, undefined, undefined, createCtx()),
    ).rejects.toThrow();

    expect(handles.size).toBe(0);
  });

  it("spawn_bg returns immediately and minion stays running in tree", async () => {
    let sessionResolve: (v: any) => void;
    vi.mocked(runMinionSession).mockReturnValue(new Promise((r) => { sessionResolve = r; }));

    const { tree, handles, queue, pi, sessions } = createDeps();
    const execute = spawnBg(tree, handles, queue, pi, sessions);

    const result = await execute(
      "tc-1", { task: "bg task" }, undefined, undefined, createCtx(),
    );

    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toContain("background");

    const running = tree.getRunning();
    expect(running).toHaveLength(1);
    expect(running[0]!.task).toBe("bg task");

    sessionResolve!({ exitCode: 0, finalOutput: "done", usage: { ...emptyUsage() } });
    await new Promise((r) => setTimeout(r, 10));
  });

  it("foreground sets detachHandle before tree.add", async () => {
    const { tree, handles, detachHandles, queue, pi, sessions } = createDeps();

    // Track when detachHandles is populated relative to tree.onChange
    let hadDetachOnAdd = false;
    tree.onChange(() => {
      const running = tree.getRunning();
      if (running.length > 0) {
        hadDetachOnAdd = detachHandles.has(running[0]!.id);
      }
    });

    const execute = spawn(tree, handles, detachHandles, queue, pi, sessions);
    await execute("tc-1", { agent: "scout", task: "t" }, undefined, undefined, createCtx());

    // detachHandle was present when tree.onChange fired during add
    expect(hadDetachOnAdd).toBe(true);
  });

  it("detach path returns immediately and keeps minion running", async () => {
    // Session that hangs until we resolve it
    let sessionResolve: (v: any) => void;
    vi.mocked(runMinionSession).mockReturnValue(new Promise((r) => { sessionResolve = r; }));

    const { tree, handles, detachHandles, queue, pi, sessions } = createDeps();
    const execute = spawn(tree, handles, detachHandles, queue, pi, sessions);

    // Start foreground spawn — will block on the session promise
    const executePromise = execute("tc-1", { task: "long task" }, undefined, undefined, createCtx());

    // The detach handle should be registered
    expect(detachHandles.size).toBe(1);
    const [minionId, handle] = [...detachHandles.entries()][0]!;

    // Trigger detach
    handle.resolve();

    // Tool should return now
    const result = await executePromise;
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toContain("USER ACTION");
    expect(text).toContain("background");

    // Minion still running in tree
    expect(tree.getRunning()).toHaveLength(1);

    // Handle kept (minion still running) but detach handle cleaned up
    expect(detachHandles.has(minionId)).toBe(false);
    expect(handles.has(minionId)).toBe(true);

    // Clean up
    sessionResolve!({ exitCode: 0, finalOutput: "done", usage: { ...emptyUsage() } });
    await new Promise((r) => setTimeout(r, 10));
  });

  it("detach path queues result and auto-delivers when session completes", async () => {
    let sessionResolve: (v: any) => void;
    vi.mocked(runMinionSession).mockReturnValue(new Promise((r) => { sessionResolve = r; }));

    const { tree, handles, detachHandles, queue, pi, sessions } = createDeps();
    const execute = spawn(tree, handles, detachHandles, queue, pi, sessions);

    const executePromise = execute("tc-1", { task: "detach task" }, undefined, undefined, createCtx());

    // Detach
    const handle = [...detachHandles.values()][0]!;
    handle.resolve();
    await executePromise;

    // Session completes after detach
    sessionResolve!({ exitCode: 0, finalOutput: "result output", usage: { ...emptyUsage(), turns: 3 } });
    await new Promise((r) => setTimeout(r, 50));

    // Result was queued
    expect(queue.getPending()).toHaveLength(0); // auto-accepted
    expect(queue.get(tree.getRoots()[0]!.id)).toBeDefined();

    // Auto-delivered to parent
    expect(pi.sendUserMessage).toHaveBeenCalledWith(
      expect.stringContaining("result output"),
      expect.objectContaining({ deliverAs: "followUp" }),
    );

    // Tree updated to completed
    const roots = tree.getRoots();
    expect(roots[0]!.status).toBe("completed");

    // Handle cleaned up
    expect(handles.size).toBe(0);
  });
});
