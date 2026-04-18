import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/agents.js", () => ({
  discoverAgents: vi.fn(),
}));
vi.mock("../../src/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/config.js")>();
  return {
    ...actual,
    getConfig: vi.fn(actual.getConfig),
  };
});

import { discoverAgents } from "../../src/agents.js";
import { getConfig } from "../../src/config.js";
import { listAgents } from "../../src/tools/list-agents.js";

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
    ui: {},
  } as any;
}

function defaultConfig() {
  return {
    minionNames: ["test"],
    allowEphemeral: true,
    delegation: { enabled: true, toolCallThreshold: 16, hintIntervalMinutes: 8 },
    display: {
      outputPreviewLines: 20,
      observabilityLines: 6,
      showStatusHints: true,
      spinnerFrames: ["[oo]"],
    },
    toolSync: { enabled: true, maxWait: 5 },
    interaction: { timeout: 300 },
  };
}

beforeEach(() => {
  vi.mocked(discoverAgents).mockReturnValue({
    agents: [mockAgent],
    projectAgentsDir: null,
  });
  vi.mocked(getConfig).mockReturnValue(defaultConfig());
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("list-agents", () => {
  it("includes ephemeral minion when allowEphemeral is true", async () => {
    const execute = listAgents();
    const result = await execute("tc", {} as never, undefined, undefined, createCtx());

    expect(result.content[0]).toHaveProperty("text");
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain("minion (built-in)");
    expect(text).toContain("scout");

    expect(result.details).toHaveLength(2);
    expect(result.details![0].name).toBe("minion");
    expect(result.details![1].name).toBe("scout");
  });

  it("hides ephemeral minion when allowEphemeral is false", async () => {
    vi.mocked(getConfig).mockReturnValue({ ...defaultConfig(), allowEphemeral: false });

    const execute = listAgents();
    const result = await execute("tc", {} as never, undefined, undefined, createCtx());

    const text = (result.content[0] as { text: string }).text;
    expect(text).not.toContain("minion (built-in)");
    expect(text).toContain("scout");

    expect(result.details).toHaveLength(1);
    expect(result.details![0].name).toBe("scout");
  });

  it("shows only named agents when ephemeral is disabled and multiple agents exist", async () => {
    const anotherAgent = {
      ...mockAgent,
      name: "builder",
      description: "Builds things",
    };
    vi.mocked(discoverAgents).mockReturnValue({
      agents: [mockAgent, anotherAgent],
      projectAgentsDir: null,
    });
    vi.mocked(getConfig).mockReturnValue({ ...defaultConfig(), allowEphemeral: false });

    const execute = listAgents();
    const result = await execute("tc", {} as never, undefined, undefined, createCtx());

    expect(result.details).toHaveLength(2);
    expect(result.details!.map((d) => d.name)).toEqual(["scout", "builder"]);
  });
});
