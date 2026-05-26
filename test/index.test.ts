import { describe, expect, it, vi } from "vitest";
import registerExtension from "../src/index.js";

function createMockPi() {
  return {
    registerTool: vi.fn(),
    registerCommand: vi.fn(),
    registerMessageRenderer: vi.fn(),
    on: vi.fn(),
    getThinkingLevel: vi.fn(),
    getAllTools: vi.fn().mockReturnValue([]),
  } as any;
}

describe("extension registration", () => {
  it("registers the foreground-only public tool surface", () => {
    const pi = createMockPi();

    registerExtension(pi);

    const toolNames = pi.registerTool.mock.calls.map((call: any[]) => call[0].name);
    expect(toolNames).toEqual([
      "spawn",
      "list_agents",
      "halt",
      "list_minion_types",
      "list_minions",
      "show_minion",
      "learn_minions",
    ]);
  });

  it("does not register removed background or steering surfaces", () => {
    const pi = createMockPi();

    registerExtension(pi);

    const toolNames = pi.registerTool.mock.calls.map((call: any[]) => call[0].name);
    const commandNames = pi.registerCommand.mock.calls.map((call: any[]) => call[0]);
    const rendererNames = pi.registerMessageRenderer.mock.calls.map((call: any[]) => call[0]);

    expect(toolNames).not.toContain("spawn" + "_bg");
    expect(toolNames).not.toContain("steer" + "_minion");
    expect(commandNames).toEqual(["spawn", "minions", "halt"]);
    expect(rendererNames).toEqual(["minion-spawn"]);
  });

  it("learn_minions returns the built-in skill text", async () => {
    const pi = createMockPi();
    registerExtension(pi);
    const learnTool = pi.registerTool.mock.calls
      .map((call: any[]) => call[0])
      .find((tool: { name: string }) => tool.name === "learn_minions");

    const result = await learnTool.execute("tc", {}, undefined, undefined, {});

    expect((result.content[0] as any).text).toContain("# pi-minions");
    expect((result.content[0] as any).text).toContain("Background minions are not available");
  });
});
