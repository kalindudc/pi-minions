import { describe, it, expect } from "vitest";
import { generateId, pickMinionName, defaultMinionTemplate, DEFAULT_MINION_PROMPT } from "../src/minions.js";
import { AgentTree } from "../src/tree.js";

describe("defaultMinionTemplate", () => {
  it("returns AgentConfig with given name and ephemeral source", () => {
    const c = defaultMinionTemplate("kevin");
    expect(c.name).toBe("kevin");
    expect(c.source).toBe("ephemeral");
    expect(c.systemPrompt).toBe(DEFAULT_MINION_PROMPT);
    expect(c.filePath).toBe("");
  });

  it("system prompt establishes minion identity", () => {
    const c = defaultMinionTemplate("kevin");
    expect(c.systemPrompt).toContain("minion");
    expect(c.systemPrompt).toContain("isolated context");
  });

  it("system prompt includes fail-fast rules", () => {
    const c = defaultMinionTemplate("kevin");
    expect(c.systemPrompt).toContain("STOP");
    expect(c.systemPrompt).toContain("Do NOT fabricate");
  });

  it("system prompt includes structured output format", () => {
    const c = defaultMinionTemplate("kevin");
    expect(c.systemPrompt).toContain("## Result");
    expect(c.systemPrompt).toContain("## Files");
    expect(c.systemPrompt).toContain("## Notes");
  });

  it("system prompt is under 1000 characters", () => {
    expect(DEFAULT_MINION_PROMPT.length).toBeLessThan(1000);
  });

  it("applies model override", () => {
    const c = defaultMinionTemplate("bob", { model: "claude-haiku-4-5" });
    expect(c.model).toBe("claude-haiku-4-5");
  });

  it("applies thinking override", () => {
    const c = defaultMinionTemplate("dave", { thinking: "low" });
    expect(c.thinking).toBe("low");
  });

  it("applies tools override", () => {
    const c = defaultMinionTemplate("stuart", { tools: ["read", "bash"] });
    expect(c.tools).toEqual(["read", "bash"]);
  });

  it("accepts steps override", () => {
    const c = defaultMinionTemplate("t", { steps: 10 });
    expect(c.steps).toBe(10);
  });

  it("accepts timeout override", () => {
    const c = defaultMinionTemplate("t", { timeout: 60000 });
    expect(c.timeout).toBe(60000);
  });

  it("leaves optional fields undefined when no overrides", () => {
    const c = defaultMinionTemplate("jerry");
    expect(c.model).toBeUndefined();
    expect(c.thinking).toBeUndefined();
    expect(c.tools).toBeUndefined();
    expect(c.steps).toBeUndefined();
    expect(c.timeout).toBeUndefined();
  });
});

describe("generateId", () => {
  it("returns 8-char hex string", () => {
    const id = generateId();
    expect(id).toHaveLength(8);
    expect(id).toMatch(/^[a-f0-9]+$/);
  });
});

describe("pickMinionName", () => {
  it("returns a name when available", () => {
    const tree = new AgentTree();
    expect(pickMinionName(tree, "x")).toBeTruthy();
  });
});
