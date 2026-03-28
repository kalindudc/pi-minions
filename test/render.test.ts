import { describe, it, expect } from "vitest";
import { formatTokens, formatDuration, formatToolCall, formatUsage, renderResult } from "../src/render.js";
import type { UsageStats } from "../src/types.js";
import { emptyUsage } from "../src/types.js";

describe("formatTokens", () => {
  it("formats small numbers as-is", () => {
    expect(formatTokens(0)).toBe("0");
    expect(formatTokens(500)).toBe("500");
    expect(formatTokens(999)).toBe("999");
  });

  it("formats thousands with k suffix", () => {
    expect(formatTokens(1000)).toBe("1.0k");
    expect(formatTokens(1500)).toBe("1.5k");
    expect(formatTokens(9999)).toBe("10.0k");
    expect(formatTokens(50000)).toBe("50k");
  });

  it("formats millions with M suffix", () => {
    expect(formatTokens(1_000_000)).toBe("1.0M");
    expect(formatTokens(1_500_000)).toBe("1.5M");
  });
});

describe("formatDuration", () => {
  it("formats sub-second as ms", () => {
    expect(formatDuration(0)).toBe("0ms");
    expect(formatDuration(500)).toBe("500ms");
    expect(formatDuration(999)).toBe("999ms");
  });

  it("formats seconds under a minute", () => {
    expect(formatDuration(1000)).toBe("1s");
    expect(formatDuration(3500)).toBe("3s");
    expect(formatDuration(59999)).toBe("59s");
  });

  it("formats minutes and seconds", () => {
    expect(formatDuration(60000)).toBe("1m 0s");
    expect(formatDuration(61000)).toBe("1m 1s");
    expect(formatDuration(90000)).toBe("1m 30s");
  });
});

describe("formatToolCall", () => {
  it("formats bash as $ <cmd>", () => {
    expect(formatToolCall("bash", { command: "ls -la" })).toBe("$ ls -la");
  });

  it("truncates long bash commands", () => {
    const long = "a".repeat(80);
    const result = formatToolCall("bash", { command: long });
    expect(result.length).toBeLessThan(80);
    expect(result).toMatch(/\.\.\.$/);
  });

  it("formats read with path", () => {
    const result = formatToolCall("read", { path: "/home/user/file.ts" });
    expect(result).toBe("read /home/user/file.ts");
  });

  it("formats unknown tool with name and args preview", () => {
    const result = formatToolCall("my_tool", { foo: "bar" });
    expect(result).toContain("my_tool");
    expect(result).toContain("foo");
  });
});

describe("formatUsage", () => {
  it("returns non-empty string for populated stats", () => {
    const usage: UsageStats = {
      input: 1000, output: 200, cacheRead: 50, cacheWrite: 10,
      cost: 0.002, contextTokens: 1260, turns: 3,
    };
    const result = formatUsage(usage);
    expect(result.length).toBeGreaterThan(0);
    expect(result).toContain("3");  // turns
  });

  it("includes model when provided", () => {
    const usage: UsageStats = {
      input: 100, output: 20, cacheRead: 0, cacheWrite: 0,
      cost: 0, contextTokens: 120, turns: 1,
    };
    expect(formatUsage(usage, "haiku")).toContain("haiku");
  });

  it("handles zero usage without throwing", () => {
    const usage: UsageStats = {
      input: 0, output: 0, cacheRead: 0, cacheWrite: 0,
      cost: 0, contextTokens: 0, turns: 0,
    };
    expect(() => formatUsage(usage)).not.toThrow();
  });
});

describe("renderResult", () => {
  // Minimal theme stub that returns text as-is (no ANSI codes)
  const theme = {
    fg: (_color: string, text: string) => text,
    bold: (text: string) => text,
  } as any;

  it("streaming render includes /minions bg hint", () => {
    const details = {
      id: "abc", name: "kevin", agentName: "kevin", task: "t",
      status: "running", usage: emptyUsage(), finalOutput: "",
      activity: "thinking…", spinnerFrame: 0,
    };
    const result = renderResult(
      { content: [], details },
      { expanded: false, isPartial: true },
      theme,
      { isError: false },
    );
    const lines = result.render(100);
    const text = lines.join("\n");
    expect(text).toContain("kevin");
    expect(text).toContain("/minions bg");
  });

  it("streaming render caches name/id to state", () => {
    const details = {
      id: "abc", name: "kevin", agentName: "kevin", task: "t",
      status: "running", usage: emptyUsage(), finalOutput: "",
      activity: "thinking…", spinnerFrame: 0,
    };
    const state: Record<string, string | undefined> = {};
    renderResult(
      { content: [], details },
      { expanded: false, isPartial: true },
      theme,
      { isError: false, state },
    );
    expect(state.cachedName).toBe("kevin");
    expect(state.cachedId).toBe("abc");
  });

  it("error render falls back to cached state when details missing", () => {
    const state = { cachedName: "kevin", cachedId: "abc123" };
    const result = renderResult(
      { content: [{ type: "text", text: "error" }], details: undefined as any },
      { expanded: false, isPartial: false },
      theme,
      { isError: true, state },
    );
    const lines = result.render(100);
    const text = lines.join("\n");
    expect(text).toContain("kevin");
    expect(text).toContain("abc123");
  });

  it("error render shows 'minion' when no details and no state", () => {
    const result = renderResult(
      { content: [{ type: "text", text: "error" }], details: undefined as any },
      { expanded: false, isPartial: false },
      theme,
      { isError: true },
    );
    const lines = result.render(100);
    const text = lines.join("\n");
    expect(text).toContain("minion");
  });
});
