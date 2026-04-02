import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { createStatusTracker, MINIONS_STATUS_KEY } from "../src/status.js";
import { AgentTree } from "../src/tree.js";
import { SubsessionManager } from "../src/subsessions/manager.js";

// Minimal theme stub
const theme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as any;

function createMockSubsessionManager() {
  return {
    getSession: vi.fn(),
    updateStatus: vi.fn(),
    list: vi.fn().mockReturnValue([]),
    getMetadata: vi.fn(),
  } as unknown as SubsessionManager;
}

describe("createStatusTracker", () => {
  let tree: AgentTree;
  let subsessionManager: SubsessionManager;
  let mockSetStatus: ReturnType<typeof vi.fn>;
  let mockUi: { setStatus: typeof mockSetStatus; theme: typeof theme };

  beforeEach(() => {
    tree = new AgentTree();
    subsessionManager = createMockSubsessionManager();
    mockSetStatus = vi.fn();
    mockUi = {
      setStatus: mockSetStatus,
      theme,
    };
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("with no UI set", () => {
    it("does not throw when refresh is called without UI", () => {
      const tracker = createStatusTracker(tree, subsessionManager);
      expect(() => tracker.refresh()).not.toThrow();
    });

    it("does not call setStatus without UI", () => {
      const tracker = createStatusTracker(tree, subsessionManager);
      tracker.refresh();
      expect(mockSetStatus).not.toHaveBeenCalled();
    });
  });

  describe("status format", () => {
    it("shows [oo] bg: count format when minions exist", () => {
      const tracker = createStatusTracker(tree, subsessionManager);
      tracker.setUi(mockUi as any);

      tree.add("bg1", "bg-minion", "task");
      tree.markDetached("bg1"); // Mark as background
      tracker.refresh();

      const lastCall = mockSetStatus.mock.calls[mockSetStatus.mock.calls.length - 1];
      expect(lastCall[0]).toBe(MINIONS_STATUS_KEY);
      expect(lastCall[1]).toContain("[oo] bg:");
      expect(lastCall[1]).toContain("1");
    });

    it("includes hint after separator", () => {
      const tracker = createStatusTracker(tree, subsessionManager);
      tracker.setUi(mockUi as any);

      tree.add("bg1", "bg-minion", "task");
      tree.markDetached("bg1"); // Mark as background
      tracker.refresh();

      const lastCall = mockSetStatus.mock.calls[mockSetStatus.mock.calls.length - 1];
      expect(lastCall[1]).toContain("·");
      expect(lastCall[1]).toContain("/minions");
    });

    it("clears status when no minions", () => {
      const tracker = createStatusTracker(tree, subsessionManager);
      tracker.setUi(mockUi as any);

      tracker.refresh();

      expect(mockSetStatus).toHaveBeenCalledWith(MINIONS_STATUS_KEY, undefined);
    });
  });

  describe("hint rotation", () => {
    it("includes static hints when no foreground minions", () => {
      const tracker = createStatusTracker(tree, subsessionManager);
      tracker.setUi(mockUi as any);

      tree.add("bg1", "bg-minion", "task");
      tree.markDetached("bg1"); // Mark as background
      tracker.refresh();

      const lastCall = mockSetStatus.mock.calls[mockSetStatus.mock.calls.length - 1];
      expect(lastCall[1]).toMatch(/\/(minions|minions list)/);
    });

    it("includes personalized hints for foreground minions", () => {
      const tracker = createStatusTracker(tree, subsessionManager);
      tracker.setUi(mockUi as any);

      tree.add("fg1", "my-agent", "task");
      // Not marked as detached = foreground (detached flag is what matters, not session presence)
      tracker.refresh();

      // Personalized hints are in the rotation - advance to see them
      // First hint might be static, so advance until we see personalized
      let foundPersonalized = false;
      for (let i = 0; i < 10; i++) {
        const lastCall = mockSetStatus.mock.calls[mockSetStatus.mock.calls.length - 1];
        if (lastCall[1].includes("my-agent")) {
          foundPersonalized = true;
          break;
        }
        vi.advanceTimersByTime(8000);
      }
      expect(foundPersonalized).toBe(true);
    });

    it("rotates hints every 8 seconds when foreground minions exist", () => {
      const tracker = createStatusTracker(tree, subsessionManager);
      tracker.setUi(mockUi as any);

      tree.add("fg1", "agent1", "task");
      // Not marked as detached = foreground
      tracker.refresh();

      const firstHint = mockSetStatus.mock.calls[mockSetStatus.mock.calls.length - 1][1];

      // Advance time by 8 seconds
      vi.advanceTimersByTime(8000);

      const secondHint = mockSetStatus.mock.calls[mockSetStatus.mock.calls.length - 1][1];
      expect(secondHint).not.toBe(firstHint);
    });

    it("stops rotation when no foreground minions remain", () => {
      const tracker = createStatusTracker(tree, subsessionManager);
      tracker.setUi(mockUi as any);

      tree.add("fg1", "agent1", "task");
      // Not marked as detached = foreground
      tracker.refresh();

      const initialCalls = mockSetStatus.mock.calls.length;

      // Complete the foreground minion
      tree.updateStatus("fg1", "completed");
      tracker.refresh();

      // Advance time - should not trigger more updates
      vi.advanceTimersByTime(8000);

      // Should only have 1 more call (the completion update)
      expect(mockSetStatus.mock.calls.length).toBe(initialCalls + 1);
    });
  });

  describe("background minions", () => {
    it("counts background minions correctly", () => {
      const tracker = createStatusTracker(tree, subsessionManager);
      tracker.setUi(mockUi as any);

      tree.add("bg1", "bg1", "task");
      tree.markDetached("bg1");
      tree.add("bg2", "bg2", "task");
      tree.markDetached("bg2");
      tracker.refresh();

      const lastCall = mockSetStatus.mock.calls[mockSetStatus.mock.calls.length - 1];
      expect(lastCall[1]).toContain("[oo] bg: 2");
    });

    it("does not count foreground minions as background", () => {
      const tracker = createStatusTracker(tree, subsessionManager);
      tracker.setUi(mockUi as any);

      tree.add("bg1", "bg1", "task");
      tree.markDetached("bg1"); // Background
      tree.add("fg1", "fg1", "task");
      // Not marked as detached = foreground
      tracker.refresh();

      const lastCall = mockSetStatus.mock.calls[mockSetStatus.mock.calls.length - 1];
      expect(lastCall[1]).toContain("[oo] bg: 1");
    });

    it("updates count when background minion completes", () => {
      const tracker = createStatusTracker(tree, subsessionManager);
      tracker.setUi(mockUi as any);

      tree.add("bg1", "bg1", "task");
      tree.markDetached("bg1");
      tracker.refresh();

      let lastCall = mockSetStatus.mock.calls[mockSetStatus.mock.calls.length - 1];
      expect(lastCall[1]).toContain("[oo] bg: 1");

      tree.updateStatus("bg1", "completed");
      tracker.refresh();

      lastCall = mockSetStatus.mock.calls[mockSetStatus.mock.calls.length - 1];
      expect(lastCall[1]).toBe(undefined); // Status cleared
    });
  });

  describe("foreground minions", () => {
    it("counts foreground minions for hint generation", () => {
      const tracker = createStatusTracker(tree, subsessionManager);
      tracker.setUi(mockUi as any);

      tree.add("fg1", "agent1", "task");
      // Not marked as detached = foreground
      tracker.refresh();

      // Advance through hints until we find the personalized one
      let foundPersonalized = false;
      for (let i = 0; i < 10; i++) {
        const lastCall = mockSetStatus.mock.calls[mockSetStatus.mock.calls.length - 1];
        if (lastCall[1].includes("agent1")) {
          foundPersonalized = true;
          break;
        }
        vi.advanceTimersByTime(8000);
      }
      expect(foundPersonalized).toBe(true);
    });

    it("generates hints for multiple foreground minions", () => {
      const tracker = createStatusTracker(tree, subsessionManager);
      tracker.setUi(mockUi as any);

      tree.add("fg1", "agent1", "task");
      tree.add("fg2", "agent2", "task");
      // Not marked as detached = foreground
      tracker.refresh();

      // Advance through hints until we find one with an agent name
      let foundAgentHint = false;
      for (let i = 0; i < 15; i++) {
        const lastCall = mockSetStatus.mock.calls[mockSetStatus.mock.calls.length - 1];
        const hasAgent1 = lastCall[1].includes("agent1");
        const hasAgent2 = lastCall[1].includes("agent2");
        if (hasAgent1 || hasAgent2) {
          foundAgentHint = true;
          break;
        }
        vi.advanceTimersByTime(8000);
      }
      expect(foundAgentHint).toBe(true);
    });
  });

  describe("setUi", () => {
    it("allows updating the UI reference", () => {
      const tracker = createStatusTracker(tree, subsessionManager);

      tree.add("bg1", "bg-minion", "task");
      tree.markDetached("bg1");
      tracker.refresh();
      expect(mockSetStatus).not.toHaveBeenCalled();

      tracker.setUi(mockUi as any);
      tracker.refresh();

      expect(mockSetStatus).toHaveBeenCalled();
    });
  });

  describe("destroy", () => {
    it("stops hint rotation when destroyed", () => {
      const tracker = createStatusTracker(tree, subsessionManager);
      tracker.setUi(mockUi as any);

      tree.add("fg1", "agent1", "task");
      // Not marked as detached = foreground
      tracker.refresh();

      const initialCalls = mockSetStatus.mock.calls.length;

      tracker.destroy();

      // Advance time - should not trigger updates
      vi.advanceTimersByTime(8000);

      expect(mockSetStatus.mock.calls.length).toBe(initialCalls);
    });
  });
});
