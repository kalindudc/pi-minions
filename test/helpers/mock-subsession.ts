import type { MinionSessionMetadata, MinionSessionHandle, CreateMinionSessionOptions } from "../../src/subsessions/types.js";

export class MockSubsessionManager {
  private sessions = new Map<string, MockAgentSession>();
  private metadata = new Map<string, MinionSessionMetadata>();

  async create(options: CreateMinionSessionOptions): Promise<MinionSessionHandle> {
    const { id, name, task } = options;

    const meta: MinionSessionMetadata = {
      sessionId: id,
      parentSession: "mock-parent",
      spawnedBy: options.spawnedBy,
      name,
      task,
      agent: options.config.name,
      createdAt: Date.now(),
      status: "running",
    };

    const session = new MockAgentSession(id);
    this.sessions.set(id, session);
    this.metadata.set(id, meta);

    return {
      id,
      path: `/mock/path/${id}.${name}.jsonl`,
      steer: async (text: string) => session.steer(text),
      abort: () => session.abort(),
    };
  }

  getMetadata(id: string): MinionSessionMetadata | undefined {
    return this.metadata.get(id);
  }

  list(): MinionSessionMetadata[] {
    return Array.from(this.metadata.values()).sort((a, b) => b.createdAt - a.createdAt);
  }

  getSession(id: string): MockAgentSession | undefined {
    return this.sessions.get(id);
  }

  updateStatus(id: string, status: MinionSessionMetadata["status"], exitCode?: number, error?: string): void {
    const meta = this.metadata.get(id);
    if (!meta) return;

    meta.status = status;
    if (exitCode !== undefined) meta.exitCode = exitCode;
    if (error !== undefined) meta.error = error;
  }
}

export class MockAgentSession {
  id: string;
  messages: unknown[] = [];
  private listeners = new Set<(event: unknown) => void>();
  private _aborted = false;
  private _steerCalls: string[] = [];

  constructor(id: string) {
    this.id = id;
  }

  subscribe(listener: (event: unknown) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  async steer(text: string): Promise<void> {
    this._steerCalls.push(text);
    // Simulate steer response
    this.emit({ type: "message_start" });
    this.emit({
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: `Steer received: ${text}` },
    });
    this.emit({ type: "message_end" });
  }

  abort(): void {
    this._aborted = true;
    this.emit({ type: "agent_end" });
  }

  private emit(event: unknown): void {
    for (const listener of this.listeners) listener(event);
  }

  get aborted(): boolean {
    return this._aborted;
  }

  get steerCalls(): string[] {
    return [...this._steerCalls];
  }
}
