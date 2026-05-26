import { describe, expect, it, vi } from "vitest";
import { createSpawnHandler, parseSpawnArgs } from "../../src/commands/spawn.js";

describe("parseSpawnArgs", () => {
  it("parses a foreground task with no flags", () => {
    expect(parseSpawnArgs("do the thing")).toEqual({
      task: "do the thing",
      model: undefined,
    });
  });

  it("extracts --model and leaves the remaining words as the task", () => {
    expect(parseSpawnArgs("find all --model haiku files")).toEqual({
      task: "find all files",
      model: "haiku",
    });
  });

  it("rejects background spawning with a clear error", () => {
    const result = parseSpawnArgs("do the thing --bg");

    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toContain("Background spawning is not available");
  });

  it("rejects unsupported flags", () => {
    const result = parseSpawnArgs("do the thing --later");

    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toContain("Unsupported flag: --later");
  });

  it("returns usage errors for empty input and missing model values", () => {
    expect(parseSpawnArgs("")).toHaveProperty("error");
    expect(parseSpawnArgs("   ")).toHaveProperty("error");
    expect(parseSpawnArgs("do thing --model")).toHaveProperty("error");
    expect(parseSpawnArgs("--model haiku")).toHaveProperty("error");
  });
});

describe("createSpawnHandler", () => {
  it("always directs the parent agent to use the foreground spawn tool", async () => {
    const sendUserMessage = vi.fn();
    const handler = createSpawnHandler({ sendUserMessage } as any);
    const ctx = { ui: { notify: vi.fn() } } as any;

    await handler("do work --model haiku", ctx);

    expect(sendUserMessage).toHaveBeenCalledWith(
      "Use the spawn tool to delegate this task to a minion: do work\nSet the model override to: haiku",
      { deliverAs: "steer" },
    );
    expect(ctx.ui.notify).not.toHaveBeenCalled();
  });

  it("notifies parse errors instead of sending a directive", async () => {
    const sendUserMessage = vi.fn();
    const handler = createSpawnHandler({ sendUserMessage } as any);
    const ctx = { ui: { notify: vi.fn() } } as any;

    await handler("--bg do work", ctx);

    expect(sendUserMessage).not.toHaveBeenCalled();
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("Background spawning is not available"),
      "error",
    );
  });
});
