import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
  createCodingTools,
} from "@mariozechner/pi-coding-agent";
import type { LoadExtensionsResult } from "@mariozechner/pi-coding-agent";
import type { AgentSessionEvent } from "@mariozechner/pi-coding-agent";
import type { Model } from "@mariozechner/pi-ai";
import type { ModelRegistry } from "@mariozechner/pi-coding-agent";
import type { AgentConfig, SpawnResult, UsageStats } from "./types.js";
import { emptyUsage } from "./types.js";
import { logger } from "./logger.js";

// Transcript logging
const TRANSCRIPT_DIR = join("/tmp", "logs", "pi-minions", "minions");

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

/**
 * Extract the last assistant message text from a session's message history.
 * Messages can have content as a plain string or as an array of content blocks
 * (the Claude API format: [{type: "text", text: "..."}]).
 */
function extractLastAssistantText(messages: unknown[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i] as Record<string, unknown> | undefined;
    if (!msg || msg["role"] !== "assistant") continue;

    const content = msg["content"];

    // Plain string content
    if (typeof content === "string") return content.trim();

    // Content block array — join all text blocks
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

// Callbacks for streaming progress to the parent
export interface MinionCallbacks {
  onToolActivity?: (activity: { type: "start" | "end"; toolName: string }) => void;
  onToolOutput?: (toolName: string, delta: string) => void;
  onTextDelta?: (delta: string, fullText: string) => void;
  onTurnEnd?: (turnCount: number) => void;
}

/** Minimal interface for external steer access to a running session. */
export interface MinionSession {
  steer(text: string): Promise<void>;
}

// In-process agent session runner
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
    parentSystemPrompt?: string;
  } & MinionCallbacks,
): Promise<SpawnResult> {
  const loader = new DefaultResourceLoader({
    cwd: opts.cwd,
    noExtensions: false,
    noSkills: false,
    noPromptTemplates: false,
    noThemes: false,
    systemPromptOverride: opts.parentSystemPrompt
      ? () => opts.parentSystemPrompt!
      : config.systemPrompt
      ? () => config.systemPrompt
      : undefined,
    // Filter out pi-minions from child sessions to prevent infinite recursion —
    // without this, a minion would re-register spawn tools and could spawn itself.
    extensionsOverride: (base: LoadExtensionsResult) => ({
      ...base,
      extensions: base.extensions.filter(ext => !ext.resolvedPath.includes("pi-minions")),
    }),
  });
  await loader.reload();

  const effectiveSystemPrompt = opts.parentSystemPrompt ?? config.systemPrompt ?? "(default)";

  const { session } = await createAgentSession({
    cwd: opts.cwd,
    model: opts.parentModel,
    tools: createCodingTools(opts.cwd),
    sessionManager: SessionManager.inMemory(opts.cwd),
    settingsManager: SettingsManager.create(),
    modelRegistry: opts.modelRegistry,
    resourceLoader: loader,
  });

  const sessionId = opts.id ?? config.name;
  if (opts.sessions) {
    opts.sessions.set(sessionId, { steer: (text) => session.steer(text) });
  }

  // Wire abort signal — forward parent's AbortSignal to the session
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

  // Timeout: per-agent config overrides global env var
  const effectiveTimeout = config.timeout
    ?? (process.env["PI_MINIONS_TIMEOUT"] ? parseInt(process.env["PI_MINIONS_TIMEOUT"], 10) || undefined : undefined);
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let graceTimeoutId: ReturnType<typeof setTimeout> | undefined;

  const transcriptId = opts.id ?? config.name;
  const minionName = opts.name ?? config.name;
  const transcript = createTranscriptWriter(transcriptId, minionName, task);
  transcript.write(`System Prompt: ${effectiveSystemPrompt}`);
  transcript.write("---");

  let currentText = "";
  let turnCount = 0;
  const usage = emptyUsage();

  // Step limit tracking
  const steps = config.steps;
  let stepLimitReached = false;
  let abortReason: string | undefined;

  // Tool output delta tracking — lastToolOutput holds cumulative text so we can extract only the new delta
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
      // partialResult is cumulative — extract only the new portion since last update
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

      // Step limit: steer at limit, allow 2 grace turns to wrap up, then force abort.
      // If the minion finishes within the grace window, session.prompt() resolves
      // naturally with abortReason unset → exitCode: 0 (graceful completion).
      if (steps !== undefined && turnCount >= steps && !stepLimitReached) {
        stepLimitReached = true;
        transcript.write(`\n=== Step limit reached (${steps}) ===`);
        logger.warn("spawn:session", "Step limit reached", { name: config.name, steps, turnCount });
        session.steer(
          "STEP LIMIT REACHED. You have used all allocated steps. " +
          "Wrap up now — summarize your progress and deliver your findings. " +
          "You have 2 more turns to finish."
        ).catch(() => {});
      } else if (stepLimitReached && turnCount > steps! + 2) {
        abortReason = "Step limit exceeded — force abort after grace period";
        logger.warn("spawn:session", "Force abort after grace period", { name: config.name, steps, turnCount });
        session.abort();
      }
    }
  });

  try {
    if (effectiveTimeout !== undefined) {
      timeoutId = setTimeout(() => {
        transcript.write(`\n=== Timeout reached (${effectiveTimeout}ms) ===`);
        logger.warn("spawn:session", "Timeout reached", { name: config.name, timeout: effectiveTimeout, turnCount });
        session.steer(
          "TIMEOUT REACHED. Your time allocation has expired. " +
          "Summarize your progress and findings now. Do NOT make any more tool calls. " +
          "This is your last turn."
        ).catch(() => {});

        // Grace period: 30s to wrap up before force abort
        graceTimeoutId = setTimeout(() => {
          abortReason = "Timeout exceeded \u2014 force abort after grace period";
          logger.warn("spawn:session", "Force abort after timeout grace", { name: config.name, timeout: effectiveTimeout, turnCount });
          session.abort();
        }, 30_000);
      }, effectiveTimeout);
    }

    logger.debug("spawn:session", "start", {
      name: config.name,
      systemPrompt: effectiveSystemPrompt,
      task: task,
    });
    await session.prompt(task);

    // session.prompt() resolves normally even after abort,
    // so check the signal and abortReason to distinguish abort from completion
    if (opts.signal?.aborted || abortReason) {
      const finalOutput = extractLastAssistantText(session.state.messages);
      const error = abortReason ?? "Aborted";
      transcript.write(`\n=== Aborted (${turnCount} turns): ${error} ===`);
      logger.debug("spawn:session", "aborted", { name: config.name, turns: turnCount, reason: error });
      return { exitCode: 1, finalOutput, usage, error };
    }

    const finalOutput = extractLastAssistantText(session.state.messages);

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
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    if (graceTimeoutId !== undefined) clearTimeout(graceTimeoutId);

    if (opts.sessions) opts.sessions.delete(sessionId);

    unsubscribe();
    abortCleanup?.();
    session.dispose();
  }
}
