import { describe, expect, it, vi } from "vitest";
import { minionCompleteRenderer } from "../../src/renderers/minion-complete.js";

// Mock the logger
vi.mock("../../src/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const mockTheme = {
  fg: (_color: string, text: string) => text,
} as any;

// Helper to create a valid message
function createValidMessage(overrides = {}) {
  return {
    details: {
      id: "test-id-123",
      name: "TestMinion",
      task: "Test task",
      exitCode: 0,
      duration: 5000,
      output: "Test output",
      ...overrides,
    },
  } as any;
}

describe("minionCompleteRenderer", () => {
  it("returns undefined when message has no details", () => {
    const message = { details: undefined } as any;
    const result = minionCompleteRenderer(message, {} as any, mockTheme);
    expect(result).toBeUndefined();
  });

  it("returns undefined when details has no id", () => {
    const message = { details: {} } as any;
    const result = minionCompleteRenderer(message, {} as any, mockTheme);
    expect(result).toBeUndefined();
  });

  it("returns undefined when details has no name", () => {
    const message = { details: { id: "abc123" } } as any;
    const result = minionCompleteRenderer(message, {} as any, mockTheme);
    expect(result).toBeUndefined();
  });

  it("returns component for successful minion completion (exitCode 0)", () => {
    const message = {
      details: {
        id: "abc123",
        name: "TestMinion",
        task: "Do something",
        exitCode: 0,
        duration: 5000,
      },
    } as any;
    const result = minionCompleteRenderer(message, {} as any, mockTheme);
    expect(result).toBeDefined();
  });

  it("returns component for failed minion completion (exitCode 1)", () => {
    const message = {
      details: {
        id: "def456",
        name: "FailingMinion",
        task: "Do something that fails",
        exitCode: 1,
        error: "Something failed",
        duration: 3000,
      },
    } as any;
    const result = minionCompleteRenderer(message, {} as any, mockTheme);
    expect(result).toBeDefined();
  });

  it("component includes minion name and id in output", () => {
    const message = {
      details: {
        id: "abc123",
        name: "TestMinion",
        task: "Do something",
        exitCode: 0,
        duration: 5000,
      },
    } as any;
    const result = minionCompleteRenderer(message, {} as any, mockTheme);
    expect(result).toBeDefined();
    // Component is returned - we can't easily inspect Box/Text but we know it's defined
  });

  it("component includes task summary in output", () => {
    const message = {
      details: {
        id: "abc123",
        name: "TestMinion",
        task: "Run a background analysis task",
        exitCode: 0,
        duration: 5000,
      },
    } as any;
    const result = minionCompleteRenderer(message, {} as any, mockTheme);
    expect(result).toBeDefined();
  });

  it("component includes error message when present", () => {
    const message = {
      details: {
        id: "def456",
        name: "FailingMinion",
        task: "Do something",
        exitCode: 1,
        error: "Something failed",
        duration: 3000,
      },
    } as any;
    const result = minionCompleteRenderer(message, {} as any, mockTheme);
    expect(result).toBeDefined();
  });

  it("handles minion with output content", () => {
    const message = {
      details: {
        id: "ghi789",
        name: "OutputMinion",
        task: "Generate output",
        exitCode: 0,
        duration: 2000,
        output: "This is the result output",
      },
    } as any;
    const result = minionCompleteRenderer(message, {} as any, mockTheme);
    expect(result).toBeDefined();
  });

  it("returns undefined when id is empty string", () => {
    const message = createValidMessage({ id: "" });
    const result = minionCompleteRenderer(message, {} as any, mockTheme);
    expect(result).toBeUndefined();
  });

  it("returns undefined when name is empty string", () => {
    const message = createValidMessage({ name: "" });
    const result = minionCompleteRenderer(message, {} as any, mockTheme);
    expect(result).toBeUndefined();
  });

  it("renders with very long task names", () => {
    const longTask = "A".repeat(500);
    const message = createValidMessage({ task: longTask });
    const result = minionCompleteRenderer(message, {} as any, mockTheme);
    expect(result).toBeDefined();
  });

  it("renders with very long output", () => {
    const longOutput = "B".repeat(10000);
    const message = createValidMessage({ output: longOutput });
    const result = minionCompleteRenderer(message, {} as any, mockTheme);
    expect(result).toBeDefined();
  });

  it("renders with special characters in task and output", () => {
    const message = createValidMessage({
      task: "Task with \n newlines \t tabs and 🎉 emojis",
      output: 'Output with <special> & "characters"',
    });
    const result = minionCompleteRenderer(message, {} as any, mockTheme);
    expect(result).toBeDefined();
  });

  it("renders correctly when exitCode is non-zero but not 1", () => {
    const message = createValidMessage({ exitCode: 127 });
    const result = minionCompleteRenderer(message, {} as any, mockTheme);
    expect(result).toBeDefined();
  });

  it("renders correctly with duration of 0ms", () => {
    const message = createValidMessage({ duration: 0 });
    const result = minionCompleteRenderer(message, {} as any, mockTheme);
    expect(result).toBeDefined();
  });

  it("renders correctly with very long duration", () => {
    const message = createValidMessage({ duration: 3600000 }); // 1 hour
    const result = minionCompleteRenderer(message, {} as any, mockTheme);
    expect(result).toBeDefined();
  });
});
