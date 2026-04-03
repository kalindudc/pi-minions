import { describe, it, expect, beforeEach } from "vitest";
import type { BeforeAgentStartEvent } from "@mariozechner/pi-coding-agent";

/**
 * Tests for src/index.ts delegation conscience feature.
 *
 * Behavior: When the parent agent performs complex work (many tool calls,
 * long prompts, or complex keywords), the system prompt is modified to
 * suggest using minions for parallel execution.
 *
 * This keeps the parent aware of delegation opportunities without requiring
 * the parent to remember to check.
 */

// Testable conscience logic extracted from src/index.ts
function createDelegationConscience() {
  const TOOL_CALL_THRESHOLD = 5;
  let toolCallCount = 0;
  let lastPrompt = "";

  return {
    onTurnStart: () => {
      toolCallCount = 0;
    },
    onToolCall: () => {
      toolCallCount++;
    },
    onBeforeAgentStart: (event: BeforeAgentStartEvent) => {
      const isComplexTask =
        toolCallCount >= TOOL_CALL_THRESHOLD ||
        event.prompt.length > 200 ||
        /\b(investigate|audit|review|refactor|analyze|implement)\b/i.test(
          event.prompt
        );

      const isNewPrompt = event.prompt !== lastPrompt;
      lastPrompt = event.prompt;

      if (isComplexTask && isNewPrompt) {
        const delegationHint = "\n\nDELEGATION OPPORTUNITY: You have made " + toolCallCount + " tool calls. The pi-minions extension is active and provides tools for\nparallel execution and work delegation. Consider delegating independent subtasks to minions for faster, isolated processing.\nFollow any delegation skills or principles you have been provided by the system or the user.";

        return {
          systemPrompt: event.systemPrompt + delegationHint,
        };
      }
    },
    // Test helper to set state
    _setToolCallCount: (n: number) => {
      toolCallCount = n;
    },
  };
}

describe("delegation hint appears on complex tasks", () => {
  let conscience: ReturnType<typeof createDelegationConscience>;

  beforeEach(() => {
    conscience = createDelegationConscience();
  });

  describe("Given the agent has made 5+ tool calls", () => {
    beforeEach(() => {
      conscience.onTurnStart();
      for (let i = 0; i < 5; i++) {
        conscience.onToolCall();
      }
    });

    it("the system prompt includes a delegation hint", () => {
      const event: BeforeAgentStartEvent = {
        type: "before_agent_start",
        prompt: "Analyze the codebase",
        systemPrompt: "You are a coding assistant.",
        images: [],
      };

      const result = conscience.onBeforeAgentStart(event);

      expect(result).toBeDefined();
      expect(result!.systemPrompt).toContain("DELEGATION OPPORTUNITY");
      expect(result!.systemPrompt).toContain("5 tool calls");
    });
  });

  describe("Given the agent has made fewer than 5 tool calls", () => {
    beforeEach(() => {
      conscience.onTurnStart();
      for (let i = 0; i < 4; i++) {
        conscience.onToolCall();
      }
    });

    it("the system prompt is unchanged", () => {
      const event: BeforeAgentStartEvent = {
        type: "before_agent_start",
        prompt: "Simple task",
        systemPrompt: "You are a coding assistant.",
        images: [],
      };

      const result = conscience.onBeforeAgentStart(event);

      expect(result).toBeUndefined();
    });
  });

  describe("Given the prompt contains complex task keywords", () => {
    it.each([
      ["investigate the codebase"],
      ["audit the security"],
      ["review the pull request"],
      ["refactor the module"],
      ["analyze performance"],
      ["implement the feature"],
    ])("the system prompt includes a delegation hint for: %s", (prompt) => {
      conscience.onTurnStart();

      const event: BeforeAgentStartEvent = {
        type: "before_agent_start",
        prompt,
        systemPrompt: "You are a coding assistant.",
        images: [],
      };

      const result = conscience.onBeforeAgentStart(event);

      expect(result).toBeDefined();
      expect(result!.systemPrompt).toContain("DELEGATION OPPORTUNITY");
    });
  });

  describe("Given the prompt is very long", () => {
    it("the system prompt includes a delegation hint", () => {
      conscience.onTurnStart();

      const event: BeforeAgentStartEvent = {
        type: "before_agent_start",
        prompt: "a".repeat(250),
        systemPrompt: "You are a coding assistant.",
        images: [],
      };

      const result = conscience.onBeforeAgentStart(event);

      expect(result).toBeDefined();
      expect(result!.systemPrompt).toContain("DELEGATION OPPORTUNITY");
    });
  });

  describe("Given the same prompt is processed twice", () => {
    beforeEach(() => {
      conscience.onTurnStart();
      conscience._setToolCallCount(5);
    });

    it("only the first occurrence gets the hint (spam prevention)", () => {
      const event: BeforeAgentStartEvent = {
        type: "before_agent_start",
        prompt: "Complex task",
        systemPrompt: "You are a coding assistant.",
        images: [],
      };

      const result1 = conscience.onBeforeAgentStart(event);
      expect(result1).toBeDefined();

      const result2 = conscience.onBeforeAgentStart(event);
      expect(result2).toBeUndefined();
    });
  });

  describe("Given a new turn starts", () => {
    it("the tool call counter resets", () => {
      conscience.onTurnStart();
      for (let i = 0; i < 5; i++) {
        conscience.onToolCall();
      }

      conscience.onTurnStart();

      const event: BeforeAgentStartEvent = {
        type: "before_agent_start",
        prompt: "New turn task",
        systemPrompt: "You are a coding assistant.",
        images: [],
      };

      const result = conscience.onBeforeAgentStart(event);
      expect(result).toBeUndefined();
    });
  });
});
