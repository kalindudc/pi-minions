import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
  createCodingTools,
} from "@mariozechner/pi-coding-agent";
import type { AgentSession, ModelRegistry } from "@mariozechner/pi-coding-agent";
import type { AgentConfig } from "../types.js";
import type { MinionSessionMetadata, MinionSessionHandle, CreateMinionSessionOptions } from "./types.js";
import { logger } from "../logger.js";
import type { EventBus } from "./event-bus.js";
import { MINION_COMPLETE_CHANNEL } from "./event-bus.js";
import { getMinionsDir, hashCwd } from "./paths.js";

export class SubsessionManager {
  private activeSessions = new Map<string, AgentSession>();
  private metadataCache = new Map<string, MinionSessionMetadata>();

  constructor(
    private cwd: string,
    private parentSessionPath: string,
    private eventBus?: EventBus
  ) {}

  async create(options: CreateMinionSessionOptions): Promise<MinionSessionHandle> {
    const { id, name, task, config, spawnedBy, modelRegistry, parentModel, parentSystemPrompt, signal } = options;

    // Create minions directory
    const minionsDir = getMinionsDir(this.cwd);
    mkdirSync(minionsDir, { recursive: true });

    const sessionPath = join(minionsDir, `${id}.${name}.jsonl`);

    // Create metadata
    const metadata: MinionSessionMetadata = {
      sessionId: id,
      parentSession: this.parentSessionPath,
      spawnedBy,
      name,
      task,
      agent: config.name,
      createdAt: Date.now(),
      status: "running",
    };

    // Create the file-based session manager using static factory
    // Use create() to create a new session file
    const sessionManager = SessionManager.create(this.cwd, minionsDir);

    // Initialize session file with metadata header (write it after SessionManager creates the file)
    this.writeMetadata(sessionManager.getSessionFile() ?? sessionPath, metadata);
    this.metadataCache.set(id, metadata);

    // Set up resource loader with extensions filtered to prevent recursion
    const loader = new DefaultResourceLoader({
      cwd: this.cwd,
      noExtensions: false,
      noSkills: false,
      noPromptTemplates: false,
      noThemes: false,
      systemPromptOverride: parentSystemPrompt
        ? () => parentSystemPrompt
        : config.systemPrompt
        ? () => config.systemPrompt
        : undefined,
      extensionsOverride: (base) => ({
        ...base,
        extensions: base.extensions.filter(ext => !ext.resolvedPath.includes("pi-minions")),
      }),
    });
    await loader.reload();

    // Create the agent session
    const { session } = await createAgentSession({
      cwd: this.cwd,
      model: parentModel,
      tools: createCodingTools(this.cwd),
      sessionManager,
      settingsManager: SettingsManager.create(),
      modelRegistry,
      resourceLoader: loader,
    });

    // Store the session for steer/halt operations
    this.activeSessions.set(id, session);

    // Track state for callbacks
    let currentFullText = "";
    let turnCount = 0;
    let completed = false;

    // Subscribe to session events for progress tracking and completion detection
    const unsubscribe = session.subscribe((event) => {
      if (event.type === "tool_execution_start") {
        options.onToolActivity?.({ type: "start", toolName: event.toolName });
      }
      if (event.type === "tool_execution_end") {
        options.onToolActivity?.({ type: "end", toolName: event.toolName });
      }
      if (event.type === "tool_execution_update" && options.onToolOutput) {
        const fullText: string = (event as any).partialResult?.content?.[0]?.text ?? "";
        options.onToolOutput(event.toolName, fullText);
      }
      if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
        currentFullText += event.assistantMessageEvent.delta;
        options.onTextDelta?.(event.assistantMessageEvent.delta, currentFullText);
      }
      if (event.type === "turn_end") {
        turnCount++;
        options.onTurnEnd?.(turnCount);
      }
      if (event.type === "agent_end" && !completed) {
        completed = true;
        const exitCode = 0; // Success - agent_end without error
        this.updateStatus(id, "completed", exitCode);
        options.onComplete?.({ exitCode, output: currentFullText });
        this.eventBus?.emit(MINION_COMPLETE_CHANNEL, { id, exitCode, output: currentFullText });
      }
    });

    // Wire abort signal
    let abortCleanup: (() => void) | undefined;
    if (signal) {
      const onAbort = () => {
        session.abort();
        this.updateStatus(id, "aborted");
        completed = true;
        options.onComplete?.({ exitCode: 1, output: currentFullText });
        this.eventBus?.emit(MINION_COMPLETE_CHANNEL, { id, exitCode: 1, output: currentFullText });
      };
      if (signal.aborted) {
        session.abort();
        this.updateStatus(id, "aborted");
        completed = true;
        options.onComplete?.({ exitCode: 1, output: currentFullText });
        this.eventBus?.emit(MINION_COMPLETE_CHANNEL, { id, exitCode: 1, output: currentFullText });
      } else {
        signal.addEventListener("abort", onAbort, { once: true });
        abortCleanup = () => signal.removeEventListener("abort", onAbort);
      }
    }

    // Clean up when session ends
    const cleanup = () => {
      unsubscribe();
      abortCleanup?.();
      this.activeSessions.delete(id);
    };

    // Start the session with the initial task
    session.prompt(task).then(() => {
      // Session completed naturally
      if (!completed) {
        completed = true;
        const exitCode = signal?.aborted ? 1 : 0;
        const status = signal?.aborted ? "aborted" : "completed";
        this.updateStatus(id, status, exitCode);
        options.onComplete?.({ exitCode, output: currentFullText });
        this.eventBus?.emit(MINION_COMPLETE_CHANNEL, { id, exitCode, output: currentFullText });
      }
      cleanup();
    }).catch((err) => {
      // Session failed
      if (!completed) {
        completed = true;
        const error = err instanceof Error ? err.message : String(err);
        this.updateStatus(id, "failed", 1, error);
        options.onComplete?.({ exitCode: 1, output: currentFullText });
        this.eventBus?.emit(MINION_COMPLETE_CHANNEL, { id, exitCode: 1, output: currentFullText, error });
      }
      cleanup();
    });

    const actualPath = sessionManager.getSessionFile() ?? sessionPath;
    logger.debug("subsession", "created", { id, name, path: actualPath });

    return {
      id,
      path: actualPath,
      steer: async (text: string) => {
        await session.steer(text);
      },
      abort: () => {
        session.abort();
        if (!completed) {
          completed = true;
          this.updateStatus(id, "aborted");
          options.onComplete?.({ exitCode: 1, output: currentFullText });
          this.eventBus?.emit(MINION_COMPLETE_CHANNEL, { id, exitCode: 1, output: currentFullText });
        }
        cleanup();
      },
    };
  }

  getMetadata(id: string): MinionSessionMetadata | undefined {
    // Check cache first
    if (this.metadataCache.has(id)) {
      return this.metadataCache.get(id);
    }

    // Try to read from disk
    const minionsDir = getMinionsDir(this.cwd);
    const files = this.listSessionFiles(minionsDir);
    
    for (const file of files) {
      if (file.startsWith(`${id}.`)) {
        const metadata = this.readMetadata(join(minionsDir, file));
        if (metadata) {
          this.metadataCache.set(id, metadata);
          return metadata;
        }
      }
    }

    return undefined;
  }

  list(): MinionSessionMetadata[] {
    const minionsDir = getMinionsDir(this.cwd);
    if (!existsSync(minionsDir)) {
      return [];
    }

    const files = this.listSessionFiles(minionsDir);
    const results: MinionSessionMetadata[] = [];

    for (const file of files) {
      const metadata = this.readMetadata(join(minionsDir, file));
      if (metadata) {
        results.push(metadata);
      }
    }

    return results.sort((a, b) => b.createdAt - a.createdAt);
  }

  getSession(id: string): AgentSession | undefined {
    return this.activeSessions.get(id);
  }

  updateStatus(id: string, status: MinionSessionMetadata["status"], exitCode?: number, error?: string): void {
    const metadata = this.metadataCache.get(id) ?? this.getMetadata(id);
    if (metadata) {
      metadata.status = status;
      if (exitCode !== undefined) metadata.exitCode = exitCode;
      if (error !== undefined) metadata.error = error;
      
      const minionsDir = getMinionsDir(this.cwd);
      const files = this.listSessionFiles(minionsDir);
      for (const file of files) {
        if (file.startsWith(`${id}.`)) {
          const sessionPath = join(minionsDir, file);
          if (existsSync(sessionPath)) {
            this.writeMetadata(sessionPath, metadata);
          }
          break;
        }
      }
      
      this.metadataCache.set(id, metadata);
    }
  }

  private listSessionFiles(dir: string): string[] {
    try {
      return readdirSync(dir).filter((f: string) => f.endsWith(".jsonl"));
    } catch {
      return [];
    }
  }

  private writeMetadata(path: string, metadata: MinionSessionMetadata): void {
    try {
      // Read existing content
      let content = "";
      if (existsSync(path)) {
        content = readFileSync(path, "utf-8");
      }
      const lines = content.split("\n").filter(Boolean);
      
      // Replace or add header
      const header = JSON.stringify({ __metadata: metadata });
      if (lines.length > 0 && lines[0].includes('"__metadata"')) {
        lines[0] = header;
      } else {
        lines.unshift(header);
      }
      
      writeFileSync(path, lines.join("\n") + "\n");
    } catch {
      // Ignore write errors
    }
  }

  private readMetadata(path: string): MinionSessionMetadata | undefined {
    try {
      const content = readFileSync(path, "utf-8");
      const firstLine = content.split("\n")[0];
      if (!firstLine) return undefined;
      
      const parsed = JSON.parse(firstLine);
      return parsed.__metadata as MinionSessionMetadata;
    } catch {
      return undefined;
    }
  }
}
