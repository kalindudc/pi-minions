import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMinionsHandler, parseMinionArgs } from "../../src/commands/minions.js";
import { ResultQueue } from "../../src/queue.js";
import { EventBus } from "../../src/subsessions/event-bus.js";
import type { SubsessionManager } from "../../src/subsessions/manager.js";
import { AgentTree } from "../../src/tree.js";

// Mock the observability module
vi.mock("../../src/subsessions/observability.js", () => ({
  showMinionObservability: vi.fn(),
  getMinionHistory: vi.fn().mockReturnValue([]),
}));

import { showMinionObservability } from "../../src/subsessions/observability.js";

// Mock the agents module
vi.mock("../../src/agents.js", () => ({
  discoverAgents: vi.fn().mockReturnValue({ agents: [], projectAgentsDir: null }),
}));

import { discoverAgents } from "../../src/agents.js";

// Mock the version module
vi.mock("../../src/version.js", () => ({
  VERSION: "0.0.0-test",
  CHANGELOG_PATH: "/mock/CHANGELOG.md",
}));

// Mock fs module
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    readFileSync: vi.fn().mockReturnValue("# Mock Changelog"),
  };
});

function createMockEventBus(): EventBus {
  return new EventBus();
}

function createMockSubsessionManager(sessions: Map<string, any> = new Map()): SubsessionManager {
  return {
    getSession: vi.fn().mockImplementation((id: string) => sessions.get(id)),
    getMetadata: vi.fn().mockImplementation((id: string) => ({
      sessionId: id,
      parentSession: "/mock/parent.jsonl",
      name: `minion-${id}`,
      task: "test task",
      status: "running",
      createdAt: Date.now(),
    })),
    getSessionPath: vi.fn().mockImplementation((id: string) => `/mock/path/${id}.jsonl`),
    getMinionIdFromPath: vi.fn().mockImplementation((path: string) => {
      if (path.includes("minion-")) {
        return path.match(/minion-[^/]+/)?.[0];
      }
      return undefined;
    }),
    updateStatus: vi.fn(),
    list: vi.fn().mockReturnValue([]),
    activeSessions: sessions,
  } as unknown as SubsessionManager;
}

function mockSession() {
  return {
    abort: vi.fn(),
    steer: vi.fn().mockResolvedValue(undefined),
    state: { messages: [] },
    getSessionStats: vi.fn().mockReturnValue({
      tokens: {
        input: 100,
        output: 50,
        cacheRead: 0,
        cacheWrite: 0,
        total: 150,
      },
      cost: 0.001,
    }),
  };
}

function createMockContext(overrides?: Partial<ExtensionCommandContext>): ExtensionCommandContext {
  return {
    cwd: "/tmp",
    ui: {
      notify: vi.fn(),
    },
    sessionManager: {
      getSessionFile: vi.fn().mockReturnValue("/mock/parent.jsonl"),
    } as unknown as ExtensionCommandContext["sessionManager"],
    switchSession: vi.fn().mockResolvedValue({ cancelled: false }),
    isIdle: vi.fn().mockReturnValue(true),
    hasPendingMessages: vi.fn().mockReturnValue(false),
    ...overrides,
  } as unknown as ExtensionCommandContext;
}

function createMockPi(): ExtensionAPI {
  return {
    sendMessage: vi.fn(),
  } as unknown as ExtensionAPI;
}

describe("parseMinionArgs", () => {
  it("empty args defaults to show-running", () => {
    expect(parseMinionArgs("")).toEqual({ action: "show-running" });
  });

  it("'list' returns list action", () => {
    expect(parseMinionArgs("list")).toEqual({ action: "list" });
  });

  it("'show abc' returns show with target", () => {
    expect(parseMinionArgs("show abc")).toEqual({
      action: "show",
      target: "abc",
    });
  });

  it("'s abc' returns show with target (shorthand)", () => {
    expect(parseMinionArgs("s abc")).toEqual({ action: "show", target: "abc" });
  });

  it("'show' without target returns error", () => {
    expect(parseMinionArgs("show")).toHaveProperty("error");
  });

  it("'bg abc' returns bg with target", () => {
    expect(parseMinionArgs("bg abc")).toEqual({ action: "bg", target: "abc" });
  });

  it("'bg' without target returns error", () => {
    expect(parseMinionArgs("bg")).toHaveProperty("error");
  });

  it("'fg kevin' returns fg with target", () => {
    expect(parseMinionArgs("fg kevin")).toEqual({ action: "fg", target: "kevin" });
  });

  it("'fg' without target returns error", () => {
    expect(parseMinionArgs("fg")).toHaveProperty("error");
    expect((parseMinionArgs("fg") as { error: string }).error).toContain("Usage: /minions fg");
  });

  it("'fg target with spaces' parses full target string", () => {
    expect(parseMinionArgs("fg my minion name")).toEqual({
      action: "fg",
      target: "my minion name",
    });
  });

  it("'steer bob restart the count' parses target and message", () => {
    expect(parseMinionArgs("steer bob restart the count")).toEqual({
      action: "steer",
      target: "bob",
      message: "restart the count",
    });
  });

  it("'steer' without enough args returns error", () => {
    expect(parseMinionArgs("steer")).toHaveProperty("error");
    expect(parseMinionArgs("steer bob")).toHaveProperty("error");
  });

  it("'version' returns version action", () => {
    expect(parseMinionArgs("version")).toEqual({ action: "version" });
  });

  it("'changelog' returns changelog action", () => {
    expect(parseMinionArgs("changelog")).toEqual({ action: "changelog" });
  });

  it("'help' returns help action", () => {
    expect(parseMinionArgs("help")).toEqual({ action: "help" });
  });

  it("'h' returns help action (shorthand)", () => {
    expect(parseMinionArgs("h")).toEqual({ action: "help" });
  });

  it("unknown subcommand returns error", () => {
    const result = parseMinionArgs("frobnicate abc");
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toContain("Unknown subcommand");
  });

  it("handles whitespace", () => {
    expect(parseMinionArgs("   ")).toEqual({ action: "show-running" });
    expect(parseMinionArgs("  bg   abc  ")).toEqual({
      action: "bg",
      target: "abc",
    });
  });
});

describe("list action shows available agents", () => {
  it("shows available agent types with discoverAgents", async () => {
    vi.mocked(discoverAgents).mockReturnValueOnce({
      agents: [
        {
          name: "test-agent",
          description: "A test agent",
          source: "project",
          model: "gpt-4",
          systemPrompt: "test",
          filePath: "/test.md",
        },
      ],
      projectAgentsDir: null,
    });

    const tree = new AgentTree();
    const queue = new ResultQueue();
    const subsessionManager = createMockSubsessionManager();
    const ctx = createMockContext();
    const eventBus = createMockEventBus();

    const handler = createMinionsHandler(tree, queue, subsessionManager, eventBus, createMockPi());
    await handler("list", ctx);

    expect(discoverAgents).toHaveBeenCalledWith(ctx.cwd, "both");
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("Available minion types:"),
      "info",
    );
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("minion (built-in)"),
      "info",
    );
    expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("test-agent"), "info");
    expect(showMinionObservability).not.toHaveBeenCalled();
  });
});

describe("default action shows running minions", () => {
  it("shows info message when no minions are running", async () => {
    const tree = new AgentTree();
    const queue = new ResultQueue();
    const subsessionManager = createMockSubsessionManager();
    const ctx = createMockContext();
    const eventBus = createMockEventBus();

    const handler = createMinionsHandler(tree, queue, subsessionManager, eventBus, createMockPi());
    await handler("", ctx);

    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "No active minions. Spawn one with /spawn or the spawn tool.",
      "info",
    );
    expect(showMinionObservability).not.toHaveBeenCalled();
  });

  it("opens observability for first minion alphabetically when minions exist", async () => {
    const tree = new AgentTree();
    const queue = new ResultQueue();
    const subsessionManager = createMockSubsessionManager();
    const ctx = createMockContext();
    const eventBus = createMockEventBus();

    tree.add("id-zebra", "zebra", "test");
    tree.add("id-alpha", "alpha", "test");

    vi.mocked(showMinionObservability).mockResolvedValue({ action: "close" });

    const handler = createMinionsHandler(tree, queue, subsessionManager, eventBus, createMockPi());
    await handler("", ctx);

    expect(showMinionObservability).toHaveBeenCalledWith(
      ctx,
      tree,
      eventBus,
      "id-alpha",
      expect.any(Function),
    );
  });
});

describe("list action opens observability", () => {
  let tree: AgentTree;
  let queue: ResultQueue;
  let subsessionManager: SubsessionManager;
  let ctx: ExtensionCommandContext;
  let eventBus: EventBus;

  beforeEach(() => {
    tree = new AgentTree();
    queue = new ResultQueue();
    subsessionManager = createMockSubsessionManager();
    ctx = createMockContext();
    eventBus = createMockEventBus();
    vi.clearAllMocks();
  });

  it("opens observability for first minion alphabetically", async () => {
    tree.add("id-zebra", "zebra", "test");
    tree.add("id-alpha", "alpha", "test");

    vi.mocked(showMinionObservability).mockResolvedValue({ action: "close" });

    const handler = createMinionsHandler(tree, queue, subsessionManager, eventBus, createMockPi());
    await handler("show alpha", ctx);

    expect(showMinionObservability).toHaveBeenCalledWith(
      ctx,
      tree,
      eventBus,
      "id-alpha",
      expect.any(Function),
    );
  });

  it("exits when user closes observability", async () => {
    tree.add("id-test", "test", "test");

    vi.mocked(showMinionObservability).mockResolvedValue({ action: "close" });

    const handler = createMinionsHandler(tree, queue, subsessionManager, eventBus, createMockPi());
    await handler("show test", ctx);

    expect(showMinionObservability).toHaveBeenCalledTimes(1);
  });

  it("exits when user presses back", async () => {
    tree.add("id-test", "test", "test");

    vi.mocked(showMinionObservability).mockResolvedValue({ action: "back" });

    const handler = createMinionsHandler(tree, queue, subsessionManager, eventBus, createMockPi());
    await handler("show test", ctx);

    expect(showMinionObservability).toHaveBeenCalledTimes(1);
  });

  it("does not switch parent session", async () => {
    tree.add("id-test", "test", "test");

    vi.mocked(showMinionObservability).mockResolvedValue({ action: "close" });

    const handler = createMinionsHandler(tree, queue, subsessionManager, eventBus, createMockPi());
    await handler("show test", ctx);

    expect(ctx.switchSession).not.toHaveBeenCalled();
  });
});

describe("show action opens specific minion", () => {
  let tree: AgentTree;
  let queue: ResultQueue;
  let subsessionManager: SubsessionManager;
  let ctx: ExtensionCommandContext;
  let eventBus: EventBus;

  beforeEach(() => {
    tree = new AgentTree();
    queue = new ResultQueue();
    subsessionManager = createMockSubsessionManager();
    ctx = createMockContext();
    eventBus = createMockEventBus();
    vi.clearAllMocks();
  });

  it("opens observability for specified minion by name", async () => {
    tree.add("id-alpha", "alpha", "test");
    tree.add("id-beta", "beta", "test");

    vi.mocked(showMinionObservability).mockResolvedValue({ action: "close" });

    const handler = createMinionsHandler(tree, queue, subsessionManager, eventBus, createMockPi());
    await handler("show beta", ctx);

    expect(showMinionObservability).toHaveBeenCalledWith(
      ctx,
      tree,
      eventBus,
      "id-beta",
      expect.any(Function),
    );
  });

  it("opens observability for specified minion by id", async () => {
    tree.add("id-alpha", "alpha", "test");

    vi.mocked(showMinionObservability).mockResolvedValue({ action: "close" });

    const handler = createMinionsHandler(tree, queue, subsessionManager, eventBus, createMockPi());
    await handler("show id-alpha", ctx);

    expect(showMinionObservability).toHaveBeenCalledWith(
      ctx,
      tree,
      eventBus,
      "id-alpha",
      expect.any(Function),
    );
  });

  it("shows error when minion not found", async () => {
    const handler = createMinionsHandler(tree, queue, subsessionManager, eventBus, createMockPi());
    await handler("show nonexistent", ctx);

    expect(ctx.ui.notify).toHaveBeenCalledWith("Minion not found: nonexistent", "error");
    expect(showMinionObservability).not.toHaveBeenCalled();
  });

  it("supports 's' shorthand", async () => {
    tree.add("id-test", "test", "test");

    vi.mocked(showMinionObservability).mockResolvedValue({ action: "close" });

    const handler = createMinionsHandler(tree, queue, subsessionManager, eventBus, createMockPi());
    await handler("s test", ctx);

    expect(showMinionObservability).toHaveBeenCalledWith(
      ctx,
      tree,
      eventBus,
      "id-test",
      expect.any(Function),
    );
  });
});

describe("version action shows version notification", () => {
  it("notifies with version info", async () => {
    const tree = new AgentTree();
    const queue = new ResultQueue();
    const subsessionManager = createMockSubsessionManager();
    const ctx = createMockContext();
    const eventBus = createMockEventBus();
    const mockPi = createMockPi();

    const handler = createMinionsHandler(tree, queue, subsessionManager, eventBus, mockPi);
    await handler("version", ctx);

    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringMatching(/pi-minions v0\.0\.0-test/),
      "info",
    );
    expect(mockPi.sendMessage).not.toHaveBeenCalled();
  });
});

describe("changelog action renders changelog", () => {
  it("calls pi.sendMessage with changelog content", async () => {
    const tree = new AgentTree();
    const queue = new ResultQueue();
    const subsessionManager = createMockSubsessionManager();
    const ctx = createMockContext();
    const eventBus = createMockEventBus();
    const mockPi = createMockPi();

    const handler = createMinionsHandler(tree, queue, subsessionManager, eventBus, mockPi);
    await handler("changelog", ctx);

    expect(mockPi.sendMessage).toHaveBeenCalledWith({
      customType: "minion-changelog",
      content: "",
      display: true,
      details: { content: "# Mock Changelog" },
    });
    expect(ctx.ui.notify).not.toHaveBeenCalled();
  });

  it("shows error when changelog file cannot be read", async () => {
    const { readFileSync } = await import("node:fs");
    vi.mocked(readFileSync).mockImplementationOnce(() => {
      throw new Error("ENOENT: file not found");
    });

    const tree = new AgentTree();
    const queue = new ResultQueue();
    const subsessionManager = createMockSubsessionManager();
    const ctx = createMockContext();
    const eventBus = createMockEventBus();
    const mockPi = createMockPi();

    const handler = createMinionsHandler(tree, queue, subsessionManager, eventBus, mockPi);
    await handler("changelog", ctx);

    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("Failed to read changelog"),
      "error",
    );
    expect(mockPi.sendMessage).not.toHaveBeenCalled();
  });
});

describe("help action shows available subcommands", () => {
  it("notifies with alphabetically sorted subcommands and descriptions", async () => {
    const tree = new AgentTree();
    const queue = new ResultQueue();
    const subsessionManager = createMockSubsessionManager();
    const ctx = createMockContext();
    const eventBus = createMockEventBus();
    const mockPi = createMockPi();

    const handler = createMinionsHandler(tree, queue, subsessionManager, eventBus, mockPi);
    await handler("help", ctx);

    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("Available /minions subcommands:"),
      "info",
    );
    // Verify alphabetical order: bg, changelog, h, help, list, show, steer, version
    const notifyCall = vi.mocked(ctx.ui.notify).mock.calls[0]?.[0] as string;
    expect(notifyCall).toContain("bg");
    expect(notifyCall).toContain("changelog");
    expect(notifyCall).toContain("list");
    expect(notifyCall).toContain("show");
    expect(notifyCall).toContain("steer");
    expect(notifyCall).toContain("version");
    expect(mockPi.sendMessage).not.toHaveBeenCalled();
  });

  it("supports 'h' shorthand", async () => {
    const tree = new AgentTree();
    const queue = new ResultQueue();
    const subsessionManager = createMockSubsessionManager();
    const ctx = createMockContext();
    const eventBus = createMockEventBus();
    const mockPi = createMockPi();

    const handler = createMinionsHandler(tree, queue, subsessionManager, eventBus, mockPi);
    await handler("h", ctx);

    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("Available /minions subcommands:"),
      "info",
    );
  });
});

describe("steer action injects message into running minion", () => {
  it("calls session.steer with wrapped message", async () => {
    const tree = new AgentTree();
    const queue = new ResultQueue();
    const sessions = new Map<string, any>();
    const subsessionManager = createMockSubsessionManager(sessions);
    const ctx = createMockContext();

    const mockSessionObj = mockSession();
    tree.add("a", "kevin", "task A");
    sessions.set("a", mockSessionObj);

    const eventBus = createMockEventBus();
    const handler = createMinionsHandler(tree, queue, subsessionManager, eventBus, createMockPi());
    await handler("steer kevin restart", ctx);

    expect(mockSessionObj.steer).toHaveBeenCalledWith(expect.stringContaining("[USER STEER]"));
    expect(mockSessionObj.steer).toHaveBeenCalledWith(expect.stringContaining("restart"));
    expect(ctx.ui.notify).toHaveBeenCalledWith(expect.any(String), "info");
  });

  it("shows error when minion not found", async () => {
    const tree = new AgentTree();
    const queue = new ResultQueue();
    const subsessionManager = createMockSubsessionManager();
    const ctx = createMockContext();

    const eventBus = createMockEventBus();
    const handler = createMinionsHandler(tree, queue, subsessionManager, eventBus, createMockPi());
    await handler("steer nope restart", ctx);

    expect(ctx.ui.notify).toHaveBeenCalledWith(expect.any(String), "error");
  });

  it("shows info when minion not running", async () => {
    const tree = new AgentTree();
    const queue = new ResultQueue();
    const subsessionManager = createMockSubsessionManager();
    const ctx = createMockContext();

    tree.add("a", "kevin", "task A");
    tree.updateStatus("a", "completed", 0);

    const eventBus = createMockEventBus();
    const handler = createMinionsHandler(tree, queue, subsessionManager, eventBus, createMockPi());
    await handler("steer kevin restart", ctx);

    expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("not running"), "info");
  });

  it("shows error when no active session", async () => {
    const tree = new AgentTree();
    const queue = new ResultQueue();
    const subsessionManager = createMockSubsessionManager();
    const ctx = createMockContext();

    tree.add("a", "kevin", "task A");

    const eventBus = createMockEventBus();
    const handler = createMinionsHandler(tree, queue, subsessionManager, eventBus, createMockPi());
    await handler("steer kevin restart", ctx);

    expect(ctx.ui.notify).toHaveBeenCalledWith(expect.any(String), "error");
  });
});
