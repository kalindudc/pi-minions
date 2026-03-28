import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
  createCodingTools,
} from "@mariozechner/pi-coding-agent";
import type { AgentSessionEvent } from "@mariozechner/pi-coding-agent";
import type { Model } from "@mariozechner/pi-ai";
import type { ModelRegistry } from "@mariozechner/pi-coding-agent";
import type { AgentConfig, SpawnResult, UsageStats } from "./types.js";
import { emptyUsage } from "./types.js";
import { logger } from "./logger.js";

// ---------------------------------------------------------------------------
// Minion transcript logging
// ---------------------------------------------------------------------------

const REPO_ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const TRANSCRIPT_DIR = join(REPO_ROOT, "tmp", "logs", "minions");

function createTranscriptWriter(id: string, name: string, task: string) {
  try { mkdirSync(TRANSCRIPT_DIR, { recursive: true }); } catch { /* ignore */ }
  const path = join(TRANSCRIPT_DIR, `${id}-${name}.log`);
  const write = (line: string) => {
    try { appendFileSync(path, line + "\n"); } catch { /* never throw from logging */ }
  };
  write(`=== Minion: ${name} (${id}) ===`);
  write(`Task: ${task}`);
  write(`Started: ${new Date().toISOString()}`);
  write("---");
  return { write, path };
}

// ---------------------------------------------------------------------------
// Callbacks for streaming progress to the parent
// ---------------------------------------------------------------------------

export interface MinionCallbacks {
  onToolActivity?: (activity: { type: "start" | "end"; toolName: string }) => void;
  onToolOutput?: (toolName: string, delta: string) => void;
  onTextDelta?: (delta: string, fullText: string) => void;
  onTurnEnd?: (turnCount: number) => void;
}

// ---------------------------------------------------------------------------
// In-process agent session runner
// ---------------------------------------------------------------------------

/** Minimal interface for external steer access to a running session. */
export interface MinionSession {
  steer(text: string): Promise<void>;
}

export async function runMinionSession(
  config: AgentConfig,
  task: string,
  opts: {
    id?: string;
    name?: string;
    signal?: AbortSignal;
    modelRegistry: ModelRegistry;
    parentModel?: Model<any>;
    cwd: string;
    sessions?: Map<string, MinionSession>;
  } & MinionCallbacks,
): Promise<SpawnResult> {
  const loader = new DefaultResourceLoader({
    cwd: opts.cwd,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    systemPromptOverride: config.systemPrompt ? () => config.systemPrompt : undefined,
  });
  await loader.reload();

  const { session } = await createAgentSession({
    cwd: opts.cwd,
    model: opts.parentModel,
    tools: createCodingTools(opts.cwd),
    sessionManager: SessionManager.inMemory(opts.cwd),
    settingsManager: SettingsManager.create(),
    modelRegistry: opts.modelRegistry,
    resourceLoader: loader,
  });

  // Expose session for steer access
  const sessionId = opts.id ?? config.name;
  if (opts.sessions) {
    opts.sessions.set(sessionId, { steer: (text) => session.steer(text) });
  }

  // Wire abort signal to session
  let abortCleanup: (() => void) | undefined;
  if (opts.signal) {
    const onAbort = () => session.abort();
    if (opts.signal.aborted) {
      session.abort();
    } else {
      opts.signal.addEventListener("abort", onAbort, { once: true });
      abortCleanup = () => opts.signal!.removeEventListener("abort", onAbort);
    }
  }

  // Transcript logging — writes raw conversation to a per-minion file
  const transcriptId = opts.id ?? config.name;
  const minionName = opts.name ?? config.name;
  const transcript = createTranscriptWriter(transcriptId, minionName, task);

  // Subscribe to session events for streaming progress + transcript
  let currentText = "";
  let turnCount = 0;
  const usage = emptyUsage();

  let lastToolOutput = "";
  let currentToolName = "";

  const unsubscribe = session.subscribe((event: AgentSessionEvent) => {
    if (event.type === "tool_execution_start") {
      lastToolOutput = "";
      currentToolName = event.toolName;
      transcript.write(`\n[tool:start] ${event.toolName} ${JSON.stringify(event.args)}`);
      opts.onToolActivity?.({ type: "start", toolName: event.toolName });
    }
    if (event.type === "tool_execution_end") {
      transcript.write(`[tool:end] ${event.toolName}${event.isError ? " (ERROR)" : ""}`);
      opts.onToolActivity?.({ type: "end", toolName: event.toolName });
      currentToolName = "";
      usage.turns = turnCount;
    }
    if (event.type === "tool_execution_update") {
      // partialResult contains the cumulative output — extract only the delta
      const fullText: string = (event as any).partialResult?.content?.[0]?.text ?? "";
      if (fullText.length > lastToolOutput.length) {
        const delta = fullText.slice(lastToolOutput.length);
        transcript.write(`[tool:output] ${delta.trimEnd()}`);
        opts.onToolOutput?.(currentToolName, delta);
      }
      lastToolOutput = fullText;
    }
    if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
      currentText += event.assistantMessageEvent.delta;
      opts.onTextDelta?.(event.assistantMessageEvent.delta, currentText);
    }
    if (event.type === "message_start") {
      currentText = "";
    }
    if (event.type === "message_end") {
      if (currentText.trim()) {
        transcript.write(`\n[assistant]\n${currentText.trim()}`);
      }
    }
    if (event.type === "turn_end") {
      turnCount++;
      transcript.write(`\n--- turn ${turnCount} ---`);
      opts.onTurnEnd?.(turnCount);
    }
  });

  try {
    logger.debug("spawn:session", "start", { name: config.name, task: task.slice(0, 120) });
    await session.prompt(task);

    // Detect abort — session.prompt() resolves normally after abort,
    // so we check the signal to distinguish abort from completion.
    if (opts.signal?.aborted) {
      const finalOutput = extractLastAssistantText(session.state.messages);
      transcript.write(`\n=== Aborted (${turnCount} turns) ===`);
      logger.debug("spawn:session", "aborted", { name: config.name, turns: turnCount });
      return { exitCode: 1, finalOutput, usage, error: "Aborted" };
    }

    // Extract final output from the last assistant message
    const finalOutput = extractLastAssistantText(session.state.messages);

    // Collect usage stats from session
    try {
      const stats = session.getSessionStats();
      usage.input = stats.tokens.input;
      usage.output = stats.tokens.output;
      usage.cacheRead = stats.tokens.cacheRead;
      usage.cacheWrite = stats.tokens.cacheWrite;
      usage.cost = stats.cost;
      usage.turns = turnCount;
    } catch {
      // Session stats may not be available
    }

    transcript.write(`\n=== Completed (${turnCount} turns) ===`);
    transcript.write(`Output:\n${finalOutput}`);
    logger.debug("spawn:session", "completed", { name: config.name, turns: turnCount, outputLen: finalOutput.length, transcript: transcript.path });
    return { exitCode: 0, finalOutput, usage };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    transcript.write(`\n=== Error: ${msg} ===`);
    logger.debug("spawn:session", "error", { name: config.name, error: msg });
    return { exitCode: 1, finalOutput: currentText, usage, error: msg };
  } finally {
    if (opts.sessions) opts.sessions.delete(sessionId);
    unsubscribe();
    abortCleanup?.();
    session.dispose();
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractLastAssistantText(messages: unknown[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i] as Record<string, unknown> | undefined;
    if (!msg || msg["role"] !== "assistant") continue;
    const content = msg["content"];
    if (typeof content === "string") return content.trim();
    if (Array.isArray(content)) {
      const text = content
        .filter((b: any) => b.type === "text" && b.text)
        .map((b: any) => b.text as string)
        .join("");
      if (text.trim()) return text.trim();
    }
  }
  return "";
}
