import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createMockSession, type MockSessionConfig } from "./helpers/mock-session.js";

// ---------------------------------------------------------------------------
// Mock the SDK — delegate to a per-test mock session
// ---------------------------------------------------------------------------

let currentMock: ReturnType<typeof createMockSession>;

vi.mock("@mariozechner/pi-coding-agent", () => ({
  createAgentSession: async () => ({ session: currentMock.session }),
  DefaultResourceLoader: class {
    constructor() {}
    async reload() {}
  },
  SessionManager: { inMemory: () => ({}) },
  SettingsManager: { create: () => ({}) },
  createCodingTools: () => [],
}));

// Import the real runMinionSession AFTER mocking
const { runMinionSession } = await import("../src/spawn.js");

function makeConfig(overrides: Record<string, unknown> = {}) {
  return {
    name: "test-minion",
    description: "test",
    systemPrompt: "test prompt",
    source: "ephemeral" as const,
    filePath: "",
    ...overrides,
  };
}

const baseOpts = {
  modelRegistry: {} as any,
  cwd: "/tmp",
};

function setupMock(config?: MockSessionConfig) {
  currentMock = createMockSession(config);
  return currentMock;
}

describe("step limit enforcement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("steers session when step limit reached", async () => {
    const mock = setupMock({ totalTurns: 10, turnDelayMs: 1 });
    const result = await runMinionSession(
      makeConfig({ steps: 3 }),
      "do something",
      baseOpts,
    );
    expect(mock.steerCalls.length).toBeGreaterThanOrEqual(1);
    expect(mock.steerCalls[0]).toContain("STEP LIMIT REACHED");
  });

  it("allows grace turn and completes normally when steer respected", async () => {
    const mock = setupMock({ totalTurns: 10, turnDelayMs: 1, respectsSteer: true });
    const result = await runMinionSession(
      makeConfig({ steps: 3 }),
      "do something",
      baseOpts,
    );
    expect(result.exitCode).toBe(0);
    expect(mock.aborted).toBe(false);
  });

  it("force aborts after grace turn when steer ignored", async () => {
    const mock = setupMock({ totalTurns: 10, turnDelayMs: 1, respectsSteer: false });
    const result = await runMinionSession(
      makeConfig({ steps: 3 }),
      "do something",
      baseOpts,
    );
    expect(result.exitCode).toBe(1);
    expect(result.error).toContain("Step limit exceeded");
  });

  it("no enforcement when under limit", async () => {
    const mock = setupMock({ totalTurns: 3, turnDelayMs: 1 });
    const result = await runMinionSession(
      makeConfig({ steps: 15 }),
      "do something",
      baseOpts,
    );
    expect(mock.steerCalls).toHaveLength(0);
    expect(mock.aborted).toBe(false);
    expect(result.exitCode).toBe(0);
  });

  it("no enforcement when steps undefined", async () => {
    const mock = setupMock({ totalTurns: 10, turnDelayMs: 1 });
    const result = await runMinionSession(
      makeConfig(),
      "do something",
      baseOpts,
    );
    expect(mock.steerCalls).toHaveLength(0);
  });

  it("preserves final output from graceful shutdown", async () => {
    const mock = setupMock({
      totalTurns: 10, turnDelayMs: 1, respectsSteer: true,
      finalMessage: "Here is my summary.",
    });
    const result = await runMinionSession(
      makeConfig({ steps: 3 }),
      "do something",
      baseOpts,
    );
    expect(result.finalOutput).toContain("Here is my summary.");
  });
});

describe("timeout enforcement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("steers session when timeout fires", async () => {
    // timeout: 80ms, each turn takes 50ms → timeout fires during turn 2
    const mock = setupMock({ totalTurns: 10, turnDelayMs: 50, respectsSteer: true });
    const result = await runMinionSession(
      makeConfig({ timeout: 80 }),
      "do something",
      baseOpts,
    );
    expect(mock.steerCalls.length).toBeGreaterThanOrEqual(1);
    expect(mock.steerCalls[0]).toContain("TIMEOUT REACHED");
  });

  it("completes gracefully when steer respected", async () => {
    const mock = setupMock({ totalTurns: 10, turnDelayMs: 50, respectsSteer: true });
    const result = await runMinionSession(
      makeConfig({ timeout: 80 }),
      "do something",
      baseOpts,
    );
    expect(result.exitCode).toBe(0);
    expect(mock.aborted).toBe(false);
  });

  it("force aborts after grace period", async () => {
    vi.useFakeTimers();
    // Mock must outlive timeout + grace: 100ms + 30s = 30,100ms
    // 50_000 turns × 1ms = 50,000ms > 30,100ms
    const mock = setupMock({ totalTurns: 50_000, turnDelayMs: 1, respectsSteer: false });

    const resultPromise = runMinionSession(
      makeConfig({ timeout: 100 }),
      "do something",
      baseOpts,
    );

    // Advance past timeout + grace period in one go
    await vi.advanceTimersByTimeAsync(31_000);

    const result = await resultPromise;
    expect(result.exitCode).toBe(1);
    expect(result.error).toContain("Timeout exceeded");
  });

  it("no trigger when session completes before timeout", async () => {
    const mock = setupMock({ totalTurns: 3, turnDelayMs: 1 });
    const result = await runMinionSession(
      makeConfig({ timeout: 5000 }),
      "do something",
      baseOpts,
    );
    expect(mock.steerCalls).toHaveLength(0);
    expect(result.exitCode).toBe(0);
  });

  it("respects PI_MINIONS_TIMEOUT env var", async () => {
    vi.stubEnv("PI_MINIONS_TIMEOUT", "80");
    const mock = setupMock({ totalTurns: 10, turnDelayMs: 50, respectsSteer: true });
    const result = await runMinionSession(
      makeConfig(),
      "do something",
      baseOpts,
    );
    expect(mock.steerCalls.length).toBeGreaterThanOrEqual(1);
    expect(mock.steerCalls[0]).toContain("TIMEOUT REACHED");
  });

  it("per-agent timeout overrides global", async () => {
    vi.stubEnv("PI_MINIONS_TIMEOUT", "5000");
    // Per-agent timeout is 80ms (short), global is 5000ms (long)
    const mock = setupMock({ totalTurns: 10, turnDelayMs: 50, respectsSteer: true });
    const result = await runMinionSession(
      makeConfig({ timeout: 80 }),
      "do something",
      baseOpts,
    );
    // Should steer because per-agent timeout fires at 80ms, not wait for global 5000ms
    expect(mock.steerCalls.length).toBeGreaterThanOrEqual(1);
    expect(mock.steerCalls[0]).toContain("TIMEOUT REACHED");
  });
});
