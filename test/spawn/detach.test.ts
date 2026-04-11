import { describe, expect, it, vi } from "vitest";
import { detachMinion, onDetach } from "../../src/spawn/detach.js";

describe("detach signals", () => {
  it("fires the handler when the matching minion id is detached", () => {
    const handler = vi.fn();
    onDetach("minion-1", handler);
    detachMinion("minion-1");
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("does not fire the handler for a mismatched minion id", () => {
    const handler = vi.fn();
    onDetach("minion-1", handler);
    detachMinion("minion-2");
    expect(handler).not.toHaveBeenCalled();
  });

  it("supports multiple handlers for the same minion id", () => {
    const handlerA = vi.fn();
    const handlerB = vi.fn();
    onDetach("minion-1", handlerA);
    onDetach("minion-1", handlerB);
    detachMinion("minion-1");
    expect(handlerA).toHaveBeenCalledTimes(1);
    expect(handlerB).toHaveBeenCalledTimes(1);
  });

  it("stops firing after the returned unsubscribe is called", () => {
    const handler = vi.fn();
    const unsubscribe = onDetach("minion-1", handler);
    unsubscribe();
    detachMinion("minion-1");
    expect(handler).not.toHaveBeenCalled();
  });
});
