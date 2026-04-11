import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ResultQueue } from "../../src/queue.js";
import { BatchCoordinator } from "../../src/spawn/batch.js";
import { runSingleMinion } from "../../src/spawn/runner.js";
import { SubsessionManager } from "../../src/subsessions/manager.js";
import type { BatchMinionItem } from "../../src/tools/spawn.js";
import { AgentTree } from "../../src/tree.js";
import { emptyUsage } from "../../src/types.js";

vi.mock("../../src/agents.js", () => ({
  discoverAgents: vi.fn(),
}));
vi.mock("../../src/spawn.js", () => ({
  runMinionSession: vi.fn(),
}));

import { discoverAgents } from "../../src/agents.js";
import { runMinionSession } from "../../src/spawn.js";

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

function createPi() {
  return {
    sendUserMessage: vi.fn(),
    sendMessage: vi.fn(),
    getAllTools: vi.fn().mockReturnValue([{ name: "read", description: "Read" }]),
  } as any;
}

function makeMinion(overrides: Partial<BatchMinionItem> = {}): BatchMinionItem {
  return {
    id: "m1",
    name: "alpha",
    agentName: "ephemeral",
    task: "do something",
    status: "running",
    usage: emptyUsage(),
    finalOutput: "",
    ...overrides,
  };
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

describe("runSingleMinion", () => {
  it("returns success and the session result on normal completion", async () => {
    const tree = new AgentTree();
    const queue = new ResultQueue();
    const pi = createPi();
    const ctx = createCtx();
    const m = makeMinion();
    tree.add(m.id, m.name, m.task);

    const coordinator = new BatchCoordinator({
      minions: [m],
      isSingleMinion: true,
      batchId: "batch-1",
      batchTask: "test",
      outputPreviewLines: 3,
      spinnerFrames: ["-"],
    });

    const controller = new AbortController();
    const detachedMinions = new Set<string>();
    const detachResolvers = new Map<string, () => void>();
    const subsessionManager = new SubsessionManager("/tmp", "/tmp/parent.jsonl");

    const result = await runSingleMinion({
      spec: { task: m.task, agent: "scout" },
      m,
      isSingleMinion: true,
      toolCallId: "tc1",
      controller,
      detachedMinions,
      detachResolvers,
      tree,
      queue,
      pi,
      ctx,
      piConfig: { toolSync: { enabled: false, maxWait: 30 }, interaction: { timeout: 60 } },
      parentToolNames: [],
      subsessionManager,
      coordinator,
    });

    expect(result.success).toBe(true);
    expect(result.result?.exitCode).toBe(0);
    expect(result.result?.finalOutput).toBe("done");
  });

  it("handles detach signals by returning detached=true", async () => {
    vi.useFakeTimers();
    vi.mocked(runMinionSession).mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(() => resolve({ exitCode: 0, finalOutput: "done", usage: emptyUsage() }), 500),
        ),
    );

    const tree = new AgentTree();
    const queue = new ResultQueue();
    const pi = createPi();
    const ctx = createCtx();
    const m = makeMinion();
    tree.add(m.id, m.name, m.task);

    const coordinator = new BatchCoordinator({
      minions: [m],
      isSingleMinion: true,
      batchId: "batch-1",
      batchTask: "test",
      outputPreviewLines: 3,
      spinnerFrames: ["-"],
    });

    const controller = new AbortController();
    const detachedMinions = new Set<string>();
    const detachResolvers = new Map<string, () => void>();
    const subsessionManager = new SubsessionManager("/tmp", "/tmp/parent.jsonl");

    const runPromise = runSingleMinion({
      spec: { task: m.task },
      m,
      isSingleMinion: true,
      toolCallId: "tc1",
      controller,
      detachedMinions,
      detachResolvers,
      tree,
      queue,
      pi,
      ctx,
      piConfig: { toolSync: { enabled: false, maxWait: 30 }, interaction: { timeout: 60 } },
      parentToolNames: [],
      subsessionManager,
      coordinator,
    });

    // Allow the detach resolver to be registered
    await vi.advanceTimersByTimeAsync(0);

    // Trigger detach via the registered resolver
    const resolver = detachResolvers.get(m.id);
    expect(resolver).toBeDefined();
    resolver!();

    const result = await runPromise;
    expect(result.detached).toBe(true);
    expect(result.success).toBe(true);
    expect(tree.get(m.id)?.detached).toBe(true);

    vi.useRealTimers();
  });

  it("forwards usage updates to the tree and the coordinator minion", async () => {
    const tree = new AgentTree();
    const queue = new ResultQueue();
    const pi = createPi();
    const ctx = createCtx();
    const m = makeMinion();
    tree.add(m.id, m.name, m.task);

    const onUpdate = vi.fn();
    const coordinator = new BatchCoordinator({
      minions: [m],
      isSingleMinion: true,
      batchId: "batch-1",
      batchTask: "test",
      outputPreviewLines: 3,
      spinnerFrames: ["-"],
      onUpdate,
    });

    vi.mocked(runMinionSession).mockImplementation(async (_config, _task, opts) => {
      opts.onUsageUpdate?.({
        input: 50,
        output: 25,
        cacheRead: 1,
        cacheWrite: 1,
        cost: 0.05,
      });
      return {
        exitCode: 0,
        finalOutput: "done",
        usage: {
          input: 50,
          output: 25,
          cacheRead: 1,
          cacheWrite: 1,
          cost: 0.05,
          contextTokens: 0,
          turns: 0,
        },
      };
    });

    const controller = new AbortController();
    const detachedMinions = new Set<string>();
    const detachResolvers = new Map<string, () => void>();
    const subsessionManager = new SubsessionManager("/tmp", "/tmp/parent.jsonl");

    await runSingleMinion({
      spec: { task: m.task },
      m,
      isSingleMinion: true,
      toolCallId: "tc1",
      controller,
      detachedMinions,
      detachResolvers,
      tree,
      queue,
      pi,
      ctx,
      piConfig: { toolSync: { enabled: false, maxWait: 30 }, interaction: { timeout: 60 } },
      parentToolNames: [],
      subsessionManager,
      coordinator,
    });

    // Tree should have received the usage update
    expect(tree.get(m.id)?.usage.input).toBe(50);
    // The coordinator's minion usage should reflect the update
    expect(m.usage.input).toBe(50);
    expect(m.usage.output).toBe(25);
    // onUpdate should have been triggered by the coordinator after usage update
    expect(onUpdate).toHaveBeenCalled();
  });
});
