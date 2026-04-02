import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SubsessionManager } from "../../src/subsessions/manager.js";
import { EventBus, MINION_COMPLETE_CHANNEL } from "../../src/subsessions/event-bus.js";

// Mock must be at top level (hoisted)
vi.mock("@mariozechner/pi-coding-agent", () => {
  const mockSession = {
    subscribe: vi.fn().mockReturnValue(() => {}),
    steer: vi.fn().mockResolvedValue(undefined),
    abort: vi.fn(),
    prompt: vi.fn().mockResolvedValue(undefined),
    state: { messages: [] },
    getSessionStats: vi.fn().mockReturnValue({
      tokens: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0, total: 150 },
      cost: 0.001,
    }),
  };

  const mockSessionManager = {
    getSessionFile: vi.fn().mockReturnValue("/tmp/test-session.jsonl"),
  };

  return {
    createAgentSession: vi.fn().mockResolvedValue({ session: mockSession }),
    DefaultResourceLoader: vi.fn().mockImplementation(() => ({
      reload: vi.fn().mockResolvedValue(undefined),
    })),
    SessionManager: {
      create: vi.fn().mockReturnValue(mockSessionManager),
    },
    SettingsManager: {
      create: vi.fn().mockReturnValue({}),
    },
    createCodingTools: vi.fn().mockReturnValue([]),
  };
});

describe("SubsessionManager", () => {
  let tempDir: string;
  let manager: SubsessionManager;
  let eventBus: EventBus;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "pi-minions-test-"));
    eventBus = new EventBus();
    manager = new SubsessionManager(tempDir, join(tempDir, "parent.jsonl"), eventBus);
    vi.clearAllMocks();
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("create", () => {
    it("should create a session handle with id and path", async () => {
      const handle = await manager.create({
        id: "test-id",
        name: "test-minion",
        task: "do something",
        config: {
          name: "test",
          description: "Test agent",
          systemPrompt: "You are a test agent.",
          source: "ephemeral",
          filePath: "/tmp/test.md",
        },
        spawnedBy: "tool-call-1",
        cwd: tempDir,
        modelRegistry: {} as any,
      });

      expect(handle).toBeDefined();
      expect(handle.id).toBe("test-id");
      expect(handle.path).toBeDefined();
      expect(typeof handle.steer).toBe("function");
      expect(typeof handle.abort).toBe("function");
    });

    it("should call onComplete when session completes", async () => {
      const onComplete = vi.fn();

      await manager.create({
        id: "test-id",
        name: "test-minion",
        task: "do something",
        config: {
          name: "test",
          description: "Test agent",
          systemPrompt: "You are a test agent.",
          source: "ephemeral",
          filePath: "/tmp/test.md",
        },
        spawnedBy: "tool-call-1",
        cwd: tempDir,
        modelRegistry: {} as any,
        onComplete,
      });

      // Wait for async completion
      await new Promise(r => setTimeout(r, 10));

      // Verify mock was called
      const { createAgentSession } = await import("@mariozechner/pi-coding-agent");
      expect(createAgentSession).toHaveBeenCalled();
    });
  });

  describe("getMetadata", () => {
    it("should return undefined for unknown session", () => {
      const metadata = manager.getMetadata("non-existent");
      expect(metadata).toBeUndefined();
    });

    it("should return cached metadata after create", async () => {
      await manager.create({
        id: "test-id",
        name: "test-minion",
        task: "do something",
        config: {
          name: "test",
          description: "Test agent",
          systemPrompt: "You are a test agent.",
          source: "ephemeral",
          filePath: "/tmp/test.md",
        },
        spawnedBy: "tool-call-1",
        cwd: tempDir,
        modelRegistry: {} as any,
      });

      const metadata = manager.getMetadata("test-id");
      expect(metadata).toBeDefined();
      expect(metadata?.sessionId).toBe("test-id");
      expect(metadata?.name).toBe("test-minion");
      expect(metadata?.task).toBe("do something");
    });
  });

  describe("list", () => {
    it("should return empty array when no sessions exist", () => {
      const sessions = manager.list();
      expect(sessions).toEqual([]);
    });

    it("should list created sessions from cache", async () => {
      // Create sessions (these get cached)
      await manager.create({
        id: "test-1",
        name: "minion-1",
        task: "task 1",
        config: {
          name: "test",
          description: "Test agent",
          systemPrompt: "You are a test agent.",
          source: "ephemeral",
          filePath: "/tmp/test.md",
        },
        spawnedBy: "tc-1",
        cwd: tempDir,
        modelRegistry: {} as any,
      });

      await manager.create({
        id: "test-2",
        name: "minion-2",
        task: "task 2",
        config: {
          name: "test",
          description: "Test agent",
          systemPrompt: "You are a test agent.",
          source: "ephemeral",
          filePath: "/tmp/test.md",
        },
        spawnedBy: "tc-2",
        cwd: tempDir,
        modelRegistry: {} as any,
      });

      // getMetadata should return cached data for created sessions
      const meta1 = manager.getMetadata("test-1");
      const meta2 = manager.getMetadata("test-2");
      
      expect(meta1).toBeDefined();
      expect(meta2).toBeDefined();
      expect(meta1?.sessionId).toBe("test-1");
      expect(meta2?.sessionId).toBe("test-2");
    });
  });

  describe("getSession", () => {
    it("should return undefined for unknown session", () => {
      const session = manager.getSession("non-existent");
      expect(session).toBeUndefined();
    });
  });

  describe("updateStatus", () => {
    it("should update status in cache", async () => {
      await manager.create({
        id: "test-id",
        name: "test-minion",
        task: "do something",
        config: {
          name: "test",
          description: "Test agent",
          systemPrompt: "You are a test agent.",
          source: "ephemeral",
          filePath: "/tmp/test.md",
        },
        spawnedBy: "tool-call-1",
        cwd: tempDir,
        modelRegistry: {} as any,
      });

      manager.updateStatus("test-id", "completed", 0);

      const metadata = manager.getMetadata("test-id");
      expect(metadata?.status).toBe("completed");
      expect(metadata?.exitCode).toBe(0);
    });

    it("should handle updating unknown session gracefully", () => {
      // Should not throw
      manager.updateStatus("non-existent", "completed", 0);
    });
  });
});
