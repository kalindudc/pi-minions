import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { discoverAgents } from "../../src/agents.js";
import { getConfig } from "../../src/config.js";
import { runMinionSession } from "../../src/spawn.js";
import { SubsessionManager } from "../../src/subsessions/manager.js";
import { spawn } from "../../src/tools/spawn.js";
import { AgentTree } from "../../src/tree.js";
import { emptyUsage } from "../../src/types.js";

vi.mock("../../src/agents.js", () => ({
  discoverAgents: vi.fn(),
}));
vi.mock("../../src/spawn.js", () => ({
  runMinionSession: vi.fn(),
}));
vi.mock("../../src/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/config.js")>();
  return {
    ...actual,
    getConfig: vi.fn(actual.getConfig),
  };
});

const mockAgent = {
  name: "scout",
  description: "Fast recon",
  systemPrompt: "You are a scout.",
  source: "user" as const,
  filePath: "/tmp/scout.md",
};

const baseConfig = {
  minionNames: ["kevin", "stuart", "bob"],
  allowEphemeral: true,
  display: {
    outputPreviewLines: 20,
    observabilityLines: 6,
    showStatusHints: true,
    spinnerFrames: ["-"],
  },
  toolSync: {
    enabled: false,
    maxWait: 5,
  },
};

function createCtx(overrides: Record<string, unknown> = {}) {
  return {
    cwd: "/tmp",
    modelRegistry: {},
    model: undefined,
    ui: { setWorkingMessage: vi.fn() },
    sessionManager: {
      getSessionFile: vi.fn().mockReturnValue("/tmp/parent.jsonl"),
    },
    ...overrides,
  } as any;
}

function createDeps() {
  const tree = new AgentTree();
  const pi = {
    getAllTools: vi.fn().mockReturnValue([
      { name: "read", description: "Read files" },
      { name: "bash", description: "Run bash" },
      { name: "spawn", description: "Spawn minions" },
    ]),
  } as any;
  const subsessionManager = new SubsessionManager("/tmp", "/tmp/parent.jsonl");
  return { tree, pi, subsessionManager };
}

beforeEach(() => {
  vi.mocked(discoverAgents).mockReturnValue({
    agents: [mockAgent],
    projectAgentsDir: null,
  });
  vi.mocked(getConfig).mockReturnValue(baseConfig);
  vi.mocked(runMinionSession).mockResolvedValue({
    exitCode: 0,
    finalOutput: "done",
    usage: { ...emptyUsage(), turns: 1 },
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("spawn foreground", () => {
  it("runs a named foreground minion to completion and updates tree state", async () => {
    const { tree, pi, subsessionManager } = createDeps();

    const result = await spawn(tree, pi, subsessionManager)(
      "tc",
      { agent: "scout", task: "find auth" },
      undefined,
      undefined,
      createCtx(),
    );

    const node = tree.getRoots()[0];
    expect(node?.status).toBe("completed");
    expect(node?.task).toBe("find auth");
    expect((result.content[0] as any).text).toContain("done");
  });

  it("spawns an ephemeral foreground minion when no agent is specified", async () => {
    const { tree, pi, subsessionManager } = createDeps();

    const result = await spawn(tree, pi, subsessionManager)(
      "tc",
      { task: "summarize" },
      undefined,
      undefined,
      createCtx(),
    );

    const node = tree.getRoots()[0];
    expect(["kevin", "stuart", "bob"]).toContain(node?.name);
    expect(node?.agentName).toBe("ephemeral");
    expect((result.content[0] as any).text).toMatch(/Minion \w+ \([0-9a-f]+\) completed/);
  });

  it("forwards explicit model overrides into minion details", async () => {
    const { tree, pi, subsessionManager } = createDeps();

    const result = await spawn(tree, pi, subsessionManager)(
      "tc",
      { task: "summarize", model: "haiku" },
      undefined,
      undefined,
      createCtx(),
    );

    expect(result.details.model).toBe("haiku");
    expect(result.details.minions?.[0]?.model).toBe("haiku");
  });

  it("throws with available agents when a named agent is unknown", async () => {
    const { tree, pi, subsessionManager } = createDeps();

    await expect(
      spawn(tree, pi, subsessionManager)(
        "tc",
        { agent: "missing", task: "work" },
        undefined,
        undefined,
        createCtx(),
      ),
    ).rejects.toThrow('Agent "missing" not found. Available: scout');
  });

  it("rejects ephemeral minions when config disables them", async () => {
    vi.mocked(getConfig).mockReturnValueOnce({ ...baseConfig, allowEphemeral: false });
    const { tree, pi, subsessionManager } = createDeps();

    await expect(
      spawn(tree, pi, subsessionManager)("tc", { task: "work" }, undefined, undefined, createCtx()),
    ).rejects.toThrow("Ephemeral minions are disabled");
  });

  it("throws when the foreground session fails", async () => {
    vi.mocked(runMinionSession).mockResolvedValueOnce({
      exitCode: 1,
      finalOutput: "boom",
      usage: emptyUsage(),
      error: "boom",
    });
    const { tree, pi, subsessionManager } = createDeps();

    await expect(
      spawn(tree, pi, subsessionManager)("tc", { task: "work" }, undefined, undefined, createCtx()),
    ).rejects.toThrow(/failed: boom/);
    expect(tree.getRoots()[0]?.status).toBe("failed");
  });
});

describe("spawn foreground batch", () => {
  it("runs multiple foreground minions and aggregates their output", async () => {
    const { tree, pi, subsessionManager } = createDeps();

    const result = await spawn(tree, pi, subsessionManager)(
      "tc",
      { tasks: [{ task: "one" }, { task: "two", agent: "scout" }] },
      undefined,
      undefined,
      createCtx(),
    );

    expect(tree.getRoots()).toHaveLength(2);
    expect(result.details.isBatch).toBe(true);
    expect(result.details.minions).toHaveLength(2);
    const text = (result.content[0] as any).text as string;
    expect(text).toContain("Batch complete: 2 completed");
    for (const minion of result.details.minions ?? []) {
      expect(text).toContain(`=== ${minion.name} ===`);
    }
  });

  it("fails the batch if any foreground minion fails", async () => {
    vi.mocked(runMinionSession)
      .mockResolvedValueOnce({ exitCode: 0, finalOutput: "ok", usage: emptyUsage() })
      .mockResolvedValueOnce({
        exitCode: 1,
        finalOutput: "bad",
        usage: emptyUsage(),
        error: "bad",
      });
    const { tree, pi, subsessionManager } = createDeps();

    await expect(
      spawn(tree, pi, subsessionManager)(
        "tc",
        { tasks: [{ task: "one" }, { task: "two" }] },
        undefined,
        undefined,
        createCtx(),
      ),
    ).rejects.toThrow(/Batch spawn failed/);
  });

  it("rejects invalid single versus batch parameter combinations", async () => {
    const { tree, pi, subsessionManager } = createDeps();
    const execute = spawn(tree, pi, subsessionManager);

    await expect(execute("tc", {}, undefined, undefined, createCtx())).rejects.toThrow(
      "Must specify either 'task' (single) or 'tasks' (batch).",
    );
    await expect(
      execute("tc", { task: "one", tasks: [{ task: "two" }] }, undefined, undefined, createCtx()),
    ).rejects.toThrow("Cannot specify both 'task' and 'tasks'.");
  });
});
