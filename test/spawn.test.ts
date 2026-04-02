/**
 * Behaviour-based tests for src/spawn.ts (runMinionSession).
 *
 * The SDK is mocked so tests run without real LLM calls. Assertions target
 * observable outcomes — exit codes, steer calls, abort state, usage — not
 * internal implementation details.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createMockSession, type MockSessionConfig } from "./helpers/mock-session.js";

// Mock the SDK — swap in a controllable session per test

let currentMock: ReturnType<typeof createMockSession>;

vi.mock("@mariozechner/pi-coding-agent", () => ({
  createAgentSession: async () => ({ session: currentMock.session }),
  DefaultResourceLoader: class {
    constructor() {}
    async reload() {}
  },
  SessionManager: {
    create: () => ({ getSessionFile: () => "/tmp/test-session.jsonl" }),
  },
  SettingsManager: { create: () => ({}) },
  createCodingTools: () => [],
}));

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
  spawnedBy: "test-call",
  parentSessionPath: "/tmp/parent.jsonl",
};

function setup(config?: MockSessionConfig) {
  currentMock = createMockSession(config);
  return currentMock;
}

beforeEach(() => vi.clearAllMocks());

// Step limit enforcement

describe("step limit enforcement", () => {
  it("steers the session with STEP LIMIT message when limit is reached", async () => {
    const mock = setup({ totalTurns: 10, turnDelayMs: 1 });
    await runMinionSession(makeConfig({ steps: 3 }), "do something", baseOpts);
    expect(mock.steerCalls.length).toBeGreaterThanOrEqual(1);
    expect(mock.steerCalls[0]).toContain("STEP LIMIT REACHED");
  });

  it("completes successfully (exit 0) when the session respects the steer", async () => {
    const mock = setup({ totalTurns: 10, turnDelayMs: 1, respectsSteer: true });
    const result = await runMinionSession(makeConfig({ steps: 3 }), "do something", baseOpts);
    expect(result.exitCode).toBe(0);
    expect(mock.aborted).toBe(false);
  });

  it("force-aborts after the grace period when the session ignores the steer", async () => {
    const mock = setup({ totalTurns: 10, turnDelayMs: 1, respectsSteer: false });
    const result = await runMinionSession(makeConfig({ steps: 3 }), "do something", baseOpts);
    expect(result.exitCode).toBe(1);
    expect(result.error).toBeDefined();
  });

  it("does not steer or abort when the session finishes under the step limit", async () => {
    const mock = setup({ totalTurns: 3, turnDelayMs: 1 });
    const result = await runMinionSession(makeConfig({ steps: 15 }), "do something", baseOpts);
    expect(mock.steerCalls).toHaveLength(0);
    expect(mock.aborted).toBe(false);
    expect(result.exitCode).toBe(0);
  });

  it("does not enforce steps when steps is undefined", async () => {
    const mock = setup({ totalTurns: 10, turnDelayMs: 1 });
    await runMinionSession(makeConfig(), "do something", baseOpts);
    expect(mock.steerCalls).toHaveLength(0);
  });
});

// Timeout enforcement

describe("timeout enforcement", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("steers the session with TIMEOUT message when timeout fires mid-run", async () => {
    // 80 ms timeout, 50 ms per turn → fires during turn 2
    const mock = setup({ totalTurns: 10, turnDelayMs: 50, respectsSteer: true });
    await runMinionSession(makeConfig({ timeout: 80 }), "do something", baseOpts);
    expect(mock.steerCalls.length).toBeGreaterThanOrEqual(1);
    expect(mock.steerCalls[0]).toContain("TIMEOUT REACHED");
  });

  it("completes successfully (exit 0) when the session respects the timeout steer", async () => {
    const mock = setup({ totalTurns: 10, turnDelayMs: 50, respectsSteer: true });
    const result = await runMinionSession(makeConfig({ timeout: 80 }), "do something", baseOpts);
    expect(result.exitCode).toBe(0);
    expect(mock.aborted).toBe(false);
  });

  it("force-aborts after the 30s grace period when the session ignores the timeout steer", async () => {
    vi.useFakeTimers();
    const mock = setup({ totalTurns: 500, turnDelayMs: 100, respectsSteer: false });
    const resultPromise = runMinionSession(
      makeConfig({ timeout: 100 }), "do something", baseOpts,
    );
    await vi.advanceTimersByTimeAsync(31_000);
    const result = await resultPromise;
    expect(result.exitCode).toBe(1);
    expect(result.error).toBeDefined();
  });

  it("does not steer when the session finishes before the timeout", async () => {
    const mock = setup({ totalTurns: 3, turnDelayMs: 1 });
    const result = await runMinionSession(makeConfig({ timeout: 5000 }), "do something", baseOpts);
    expect(mock.steerCalls).toHaveLength(0);
    expect(result.exitCode).toBe(0);
  });

  it("respects PI_MINIONS_TIMEOUT environment variable", async () => {
    vi.stubEnv("PI_MINIONS_TIMEOUT", "80");
    const mock = setup({ totalTurns: 10, turnDelayMs: 50, respectsSteer: true });
    await runMinionSession(makeConfig(), "do something", baseOpts);
    expect(mock.steerCalls.length).toBeGreaterThanOrEqual(1);
    expect(mock.steerCalls[0]).toContain("TIMEOUT REACHED");
  });

  it("per-agent timeout takes precedence over PI_MINIONS_TIMEOUT", async () => {
    vi.stubEnv("PI_MINIONS_TIMEOUT", "5000"); // global is long
    const mock = setup({ totalTurns: 10, turnDelayMs: 50, respectsSteer: true });
    await runMinionSession(makeConfig({ timeout: 80 }), "do something", baseOpts); // agent is short
    expect(mock.steerCalls.length).toBeGreaterThanOrEqual(1);
    expect(mock.steerCalls[0]).toContain("TIMEOUT REACHED");
  });
});

// Halt via abort signal

describe("halt via abort signal", () => {
  it("aborts the session and returns exit 1 when the signal fires", async () => {
    const mock = setup({ totalTurns: 10, turnDelayMs: 10 });
    const controller = new AbortController();

    const resultPromise = runMinionSession(
      makeConfig(), "do something", { ...baseOpts, signal: controller.signal },
    );
    await new Promise((r) => setTimeout(r, 20)); // let session start
    controller.abort();
    const result = await resultPromise;

    expect(result.exitCode).toBe(1);
    expect(mock.aborted).toBe(true);
  });
});
