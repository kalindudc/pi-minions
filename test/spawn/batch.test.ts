import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BatchCoordinator, formatBatchOutput } from "../../src/spawn/batch.js";
import type { BatchMinionItem } from "../../src/tools/spawn.js";
import { emptyUsage } from "../../src/types.js";

function makeMinion(overrides: Partial<BatchMinionItem> = {}): BatchMinionItem {
  return {
    id: "m1",
    name: "alpha",
    agentName: "ephemeral",
    task: "task",
    status: "running",
    usage: emptyUsage(),
    finalOutput: "out",
    ...overrides,
  };
}

describe("formatBatchOutput", () => {
  it("returns the single minion output without wrapping when single", () => {
    const minions = [makeMinion({ finalOutput: "hello" })];
    expect(formatBatchOutput(minions, true)).toBe("hello");
  });

  it("wraps each minion output with its name when multi", () => {
    const minions = [
      makeMinion({ name: "alpha", finalOutput: "hello" }),
      makeMinion({ name: "beta", finalOutput: "world" }),
    ];
    expect(formatBatchOutput(minions, false)).toBe("=== alpha ===\nhello\n\n=== beta ===\nworld");
  });
});

describe("BatchCoordinator", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function createCoordinator(minions: BatchMinionItem[], onUpdate = vi.fn()) {
    return new BatchCoordinator({
      minions,
      isSingleMinion: minions.length === 1,
      batchId: "batch-1",
      batchTask: "test batch",
      outputPreviewLines: 3,
      spinnerFrames: ["-", "\\", "|", "/"],
      onUpdate,
    });
  }

  it("advances spinner frames for running minions and emits updates", () => {
    const minions = [makeMinion({ status: "running", spinnerFrame: 0 })];
    const onUpdate = vi.fn();
    const coordinator = createCoordinator(minions, onUpdate);
    coordinator.start();
    vi.advanceTimersByTime(100);
    expect(minions[0].spinnerFrame).toBe(1);
    expect(onUpdate).toHaveBeenCalled();
    coordinator.stop();
  });

  it("does not leak the interval after stop() is called", () => {
    const minions = [makeMinion({ status: "running" })];
    const coordinator = createCoordinator(minions);
    coordinator.start();
    coordinator.stop();
    const before = minions[0].spinnerFrame ?? 0;
    vi.advanceTimersByTime(300);
    expect(minions[0].spinnerFrame ?? 0).toBe(before);
  });

  it("getStatus returns aborted when any minion is aborted", () => {
    const minions = [makeMinion({ status: "completed" }), makeMinion({ status: "aborted" })];
    const coordinator = createCoordinator(minions);
    expect(coordinator.getStatus()).toBe("aborted");
  });

  it("getStatus returns failed when any minion failed and none aborted", () => {
    const minions = [makeMinion({ status: "running" }), makeMinion({ status: "failed" })];
    const coordinator = createCoordinator(minions);
    expect(coordinator.getStatus()).toBe("failed");
  });

  it("getStatus returns completed when all minions are completed", () => {
    const minions = [makeMinion({ status: "completed" }), makeMinion({ status: "completed" })];
    const coordinator = createCoordinator(minions);
    expect(coordinator.getStatus()).toBe("completed");
  });

  it("getStatus returns running when some minions are still running", () => {
    const minions = [makeMinion({ status: "running" }), makeMinion({ status: "completed" })];
    const coordinator = createCoordinator(minions);
    expect(coordinator.getStatus()).toBe("running");
  });

  it("getStatus returns running when all minions are excluded (detached)", () => {
    const minions = [makeMinion({ status: "running" })];
    const coordinator = createCoordinator(minions);
    expect(coordinator.getStatus(new Set(["m1"]))).toBe("running");
  });

  it("getUsage sums all fields across minions", () => {
    const minions = [
      makeMinion({
        usage: {
          input: 10,
          output: 5,
          cacheRead: 1,
          cacheWrite: 1,
          cost: 1,
          contextTokens: 100,
          turns: 2,
        },
      }),
      makeMinion({
        usage: {
          input: 20,
          output: 10,
          cacheRead: 2,
          cacheWrite: 2,
          cost: 2,
          contextTokens: 200,
          turns: 3,
        },
      }),
    ];
    const coordinator = createCoordinator(minions);
    expect(coordinator.getUsage()).toEqual({
      input: 30,
      output: 15,
      cacheRead: 3,
      cacheWrite: 3,
      cost: 3,
      contextTokens: 300,
      turns: 5,
    });
  });
});
