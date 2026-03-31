import { describe, it, expect, vi } from "vitest";
import { ResultQueue } from "../src/queue.js";
import type { QueuedResult } from "../src/types.js";
import { emptyUsage } from "../src/types.js";

function createResult(overrides?: Partial<QueuedResult>): QueuedResult {
  return {
    id: "abc123",
    name: "kevin",
    task: "do the thing",
    output: "done",
    usage: emptyUsage(),
    status: "pending",
    completedAt: Date.now(),
    duration: 1000,
    exitCode: 0,
    ...overrides,
  };
}

describe("ResultQueue", () => {
  it("add and get", () => {
    const q = new ResultQueue();
    const r = createResult();
    q.add(r);
    expect(q.get("abc123")).toBe(r);
  });

  it("get returns undefined for unknown id", () => {
    const q = new ResultQueue();
    expect(q.get("nope")).toBeUndefined();
  });

  it("getPending returns only pending results", () => {
    const q = new ResultQueue();
    q.add(createResult({ id: "a", status: "pending" }));
    q.add(createResult({ id: "b", status: "accepted" }));
    q.add(createResult({ id: "c", status: "pending" }));
    const pending = q.getPending();
    expect(pending).toHaveLength(2);
    expect(pending.map((r) => r.id)).toEqual(["a", "c"]);
  });

  it("accept removes delivered result from queue", () => {
    const q = new ResultQueue();
    q.add(createResult({ id: "a" }));
    q.accept("a");
    expect(q.get("a")).toBeUndefined();
  });

  it("accept is no-op for non-pending", () => {
    const q = new ResultQueue();
    q.add(createResult({ id: "a", status: "accepted" }));
    q.accept("a");
    expect(q.get("a")!.status).toBe("accepted");
  });

  it("accept is no-op for unknown id", () => {
    const q = new ResultQueue();
    q.accept("nope"); // should not throw
  });

  it("onChange fires on add and accept", () => {
    const q = new ResultQueue();
    const listener = vi.fn();
    q.onChange(listener);
    q.add(createResult({ id: "a" }));
    expect(listener).toHaveBeenCalledTimes(1);
    q.accept("a");
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("onChange unsubscribe stops notifications", () => {
    const q = new ResultQueue();
    const listener = vi.fn();
    const unsub = q.onChange(listener);
    q.add(createResult({ id: "a" }));
    expect(listener).toHaveBeenCalledTimes(1);
    unsub();
    q.add(createResult({ id: "b" }));
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
