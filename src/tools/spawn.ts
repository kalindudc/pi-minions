import type {
  AgentToolResult,
  AgentToolUpdateCallback,
  ExtensionAPI,
  ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import type { Static } from "@sinclair/typebox";
import { Type } from "@sinclair/typebox";
import { discoverAgents } from "../agents.js";
import { getConfig } from "../config.js";
import { logger } from "../logger.js";
import { defaultMinionTemplate, generateId, pickMinionName } from "../minions.js";
import type { ResultQueue } from "../queue.js";
import { formatToolCall } from "../render.js";
import { runMinionSession } from "../spawn.js";
import { EventBus } from "../subsessions/event-bus.js";
import type { SubsessionManager } from "../subsessions/manager.js";
import type { AgentTree } from "../tree.js";
import type { AgentConfig, AgentStatus, UsageStats } from "../types.js";
import { emptyUsage } from "../types.js";

// Parameter schemas
// NOTE: Using a flat schema with optional fields for model-agnostic compatibility
// (OpenAI doesn't support anyOf/oneOf in function schemas)
const TaskDescriptor = Type.Object({
  task: Type.String(),
  agent: Type.Optional(Type.String()),
  model: Type.Optional(Type.String()),
});

export const SpawnToolParams = Type.Object({
  // Single task mode - use task directly
  task: Type.Optional(
    Type.String({ description: "Task to delegate to the agent (use this OR tasks, not both)" }),
  ),
  agent: Type.Optional(
    Type.String({
      description:
        "Name of the agent to invoke. If omitted, spawns an ephemeral minion with default capabilities.",
    }),
  ),
  model: Type.Optional(Type.String({ description: "Override the agent's model" })),
  // Batch mode - use tasks array
  tasks: Type.Optional(
    Type.Array(TaskDescriptor, {
      minItems: 1,
      description: "Array of task descriptors for batch spawning (use this OR task, not both)",
    }),
  ),
});
export type SpawnToolParams = Static<typeof SpawnToolParams>;

// Type guard for batch detection
function isBatchParams(params: SpawnToolParams): boolean {
  return "tasks" in params && Array.isArray(params.tasks) && params.tasks.length > 0;
}

export const SpawnBgToolParams = Type.Object({
  agent: Type.Optional(
    Type.String({
      description:
        "Name of the agent to invoke. If omitted, spawns an ephemeral minion with default capabilities.",
    }),
  ),
  task: Type.String({ description: "Task to delegate to the agent" }),
  model: Type.Optional(Type.String({ description: "Override the agent's model" })),
});
export type SpawnBgToolParams = Static<typeof SpawnBgToolParams>;

// Types
export interface BatchMinionItem {
  id: string;
  name: string;
  agentName: string;
  task: string;
  status: AgentStatus;
  usage: UsageStats;
  model?: string;
  finalOutput: string;
  activity?: string;
  spinnerFrame?: number;
  /** True if moved to background */
  detached?: boolean;
}

export interface SpawnToolDetails {
  id: string;
  name: string;
  agentName: string;
  task: string;
  status: AgentStatus;
  usage: UsageStats;
  model?: string;
  finalOutput: string;
  activity?: string;
  spinnerFrame?: number;
  detached?: boolean;
  isBatch?: boolean;
  minions?: BatchMinionItem[];
  outputPreviewLines?: number;
  spinnerFrames?: string[];
}

// Config resolution
function resolveConfig(
  params: { agent?: string; task: string; model?: string },
  name: string,
  cwd: string,
): AgentConfig {
  if (params.agent) {
    const { agents } = discoverAgents(cwd, "both");
    const found = agents.find((a) => a.name === params.agent);
    if (!found) {
      const available = agents.map((a) => a.name).join(", ") || "none";
      logger.warn("spawn:tool", "agent not found", {
        requested: params.agent,
        available,
      });
      throw new Error(`Agent "${params.agent}" not found. Available: ${available}`);
    }
    return found;
  }
  return defaultMinionTemplate(name, { model: params.model });
}

// Process background minion completion - async function that handles the session promise
async function processBgCompletion(
  sessionPromise: Promise<import("../types.js").SpawnResult>,
  id: string,
  name: string,
  task: string,
  startTime: number,
  tree: AgentTree,
  queue: ResultQueue,
  pi: ExtensionAPI,
): Promise<void> {
  let result: import("../types.js").SpawnResult;

  try {
    result = await sessionPromise;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("spawn:bg-completion", "sessionPromise-rejected", { id, name, error: msg });
    tree.updateStatus(id, "failed", 1, msg);
    logger.error("spawn:tool", "bg-failed", { id, name, error: msg });
    return;
  }

  logger.debug("spawn:bg-completion", "sessionPromise-resolved", {
    id,
    name,
    exitCode: result.exitCode,
    hasOutput: !!result.finalOutput,
    outputLength: result.finalOutput?.length,
    outputPreview: result.finalOutput?.slice(0, 200),
    hasError: !!result.error,
  });

  const status = result.exitCode === 0 ? "completed" : "failed";
  tree.updateStatus(id, status, result.exitCode, result.error);
  tree.updateUsage(id, result.usage);
  logger.debug("spawn:bg-completion", "tree-updated", { id, status });

  queue.add({
    id,
    name,
    task,
    output: result.finalOutput,
    usage: result.usage,
    status: "pending",
    completedAt: Date.now(),
    duration: Date.now() - startTime,
    exitCode: result.exitCode,
    error: result.error,
  });
  logger.debug("spawn:bg-completion", "queue-add-called", { id });

  // Content visible to LLM - brief system indicator that parent should react
  const content = `[Background minion "${name}" completed - exit code: ${result.exitCode}]`;

  try {
    const messagePayload = {
      customType: "minion-complete" as const,
      content,
      display: true,
      details: {
        id,
        name,
        task,
        exitCode: result.exitCode,
        error: result.error,
        duration: Date.now() - startTime,
        output: result.finalOutput, // Full output for renderer
      },
    };

    pi.sendMessage(messagePayload, { triggerTurn: true });
    logger.debug("spawn:bg-completion", "sendMessage-called", { id, name, triggerTurn: true });
  } catch (sendErr) {
    const sendMsg = sendErr instanceof Error ? sendErr.message : String(sendErr);
    logger.error("spawn:bg-completion", "sendMessage-failed", { id, error: sendMsg });
  }

  queue.accept(id);
  logger.info("spawn:tool", "bg-completed", {
    id,
    name,
    exitCode: result.exitCode,
  });
}

// Handle background completion - fire-and-forget wrapper
function handleBgCompletion(
  sessionPromise: Promise<import("../types.js").SpawnResult>,
  id: string,
  name: string,
  task: string,
  startTime: number,
  tree: AgentTree,
  queue: ResultQueue,
  pi: ExtensionAPI,
): void {
  logger.debug("spawn:bg-completion", "handleBgCompletion-called", { id, name, task });
  // Fire-and-forget: don't await the promise, errors are handled internally
  processBgCompletion(sessionPromise, id, name, task, startTime, tree, queue, pi);
}

// Create shared event bus for detach signals
function createDetachBus() {
  const bus = new EventBus();
  return {
    emit: (id: string) => bus.emit("detach", id),
    on: (id: string, handler: () => void) => {
      const unsubscribe = bus.on<string>("detach", (detachedId) => {
        if (detachedId === id) handler();
      });
      return unsubscribe;
    },
  };
}

// Shared detach bus across all spawn calls
const detachBus = createDetachBus();

/** Detach a foreground minion */
export function detachMinion(id: string): void {
  detachBus.emit(id);
}

// Unified spawn execution - treats everything as a batch internally
// The renderer handles the difference between 1 vs many minions
async function executeSpawn(
  specs: Array<{ task: string; agent?: string; model?: string }>,
  toolCallId: string,
  tree: AgentTree,
  _queue: ResultQueue,
  pi: ExtensionAPI,
  subsessionManager: SubsessionManager,
  signal: AbortSignal | undefined,
  onUpdate: AgentToolUpdateCallback<SpawnToolDetails> | undefined,
  ctx: ExtensionContext,
): Promise<AgentToolResult<SpawnToolDetails>> {
  const isSingleMinion = specs.length === 1;
  const config = getConfig(ctx);
  const spinnerFrames = config.display.spinnerFrames;
  const outputPreviewLines = config.display.outputPreviewLines;

  logger.info("spawn:tool", isSingleMinion ? "start" : "batch-start", {
    count: specs.length,
  });

  if (!isSingleMinion) {
    logger.debug("spawn:tool", "batch-minions", {
      minions: specs.map((s, i) => ({
        index: i,
        agent: s.agent ?? "ephemeral",
        task: s.task.slice(0, 50),
      })),
    });
  }

  // Create minion items - track assigned names to ensure uniqueness
  const assignedNames = new Set<string>();

  const minions: BatchMinionItem[] = specs.map((spec) => {
    const id = generateId();
    const name = pickMinionName(tree, id, ctx);
    assignedNames.add(name);

    // Resolve config and model immediately so it's available for emitUpdate
    const config = resolveConfig(spec, name, ctx.cwd);
    const resolvedModel = spec.model ?? config.model ?? ctx.model?.id;

    return {
      id,
      name,
      agentName: spec.agent ?? "ephemeral",
      task: spec.task,
      status: "running",
      usage: emptyUsage(),
      model: resolvedModel,
      finalOutput: "",
      activity: "starting...",
      spinnerFrame: 0,
    };
  });

  // Add all to tree
  for (const m of minions) {
    tree.add(m.id, m.name, m.task, undefined, m.agentName);
  }

  // Shared abort controller
  const controller = new AbortController();
  if (signal) {
    const onAbort = () => controller.abort();
    if (signal.aborted) {
      controller.abort();
    } else {
      signal.addEventListener("abort", onAbort, { once: true });
    }
  }

  // Spinner animation - runs independently every 100ms regardless of minion activity
  let completed = false;
  const spinnerInterval = setInterval(() => {
    if (completed) return;

    let frameUpdated = false;
    for (const m of minions) {
      if (m.status === "running") {
        m.spinnerFrame = (m.spinnerFrame ?? 0) + 1;
        frameUpdated = true;
      }
    }

    // Only emit update if at least one minion is still running
    // This prevents unnecessary updates after all minions complete
    if (frameUpdated) {
      emitUpdate();
    }
  }, 100);

  // Create batch tracking ID
  const batchId = generateId();
  const batchName = isSingleMinion ? minions[0].name : `batch-${batchId.slice(0, 8)}`;

  // Emit update function
  const emitUpdate = () => {
    if (completed) return;

    const firstMinion = minions[0];
    const allCompleted = minions.every((m) => m.status === "completed");
    const anyFailed = minions.some((m) => m.status === "failed");
    const anyAborted = minions.some((m) => m.status === "aborted");
    const status = anyAborted
      ? "aborted"
      : anyFailed
        ? "failed"
        : allCompleted
          ? "completed"
          : "running";

    const totalUsage = minions.reduce(
      (acc, m) => ({
        input: acc.input + m.usage.input,
        output: acc.output + m.usage.output,
        cacheRead: acc.cacheRead + m.usage.cacheRead,
        cacheWrite: acc.cacheWrite + m.usage.cacheWrite,
        cost: acc.cost + m.usage.cost,
        contextTokens: acc.contextTokens + m.usage.contextTokens,
        turns: acc.turns + m.usage.turns,
      }),
      emptyUsage(),
    );

    // For single minion with simple output, don't wrap with name
    const finalOutput =
      isSingleMinion && minions.length === 1
        ? firstMinion.finalOutput
        : minions.map((m) => `=== ${m.name} ===\n${m.finalOutput}`).join("\n\n");

    onUpdate?.({
      content: [{ type: "text", text: "" }],
      details: {
        id: isSingleMinion ? firstMinion.id : batchId,
        name: isSingleMinion ? firstMinion.name : batchName,
        agentName: isSingleMinion ? firstMinion.agentName : "batch",
        task: isSingleMinion ? firstMinion.task : `batch of ${specs.length} minions`,
        isBatch: true,
        minions: [...minions],
        status,
        usage: totalUsage,
        model: firstMinion.model,
        finalOutput,
        outputPreviewLines,
        spinnerFrames,
      },
    });
  };

  // Track detached minions
  const detachedMinions = new Set<string>();
  const detachResolvers = new Map<string, () => void>();

  // Run all minions in parallel
  const sessionPromises = minions.map(async (m, index) => {
    const spec = specs[index];
    if (!spec) {
      throw new Error(`No spec found for minion at index ${index}`);
    }

    // Config was already resolved when creating minion, but we need it here for runMinionSession
    const config = resolveConfig(spec, m.name, ctx.cwd);

    // Emit initial update for this minion
    emitUpdate();

    try {
      const sessionPromise = runMinionSession(config, spec.task, {
        id: m.id,
        name: m.name,
        signal: controller.signal,
        modelRegistry: ctx.modelRegistry,
        parentModel: ctx.model,
        cwd: ctx.cwd,
        subsessionManager,
        spawnedBy: toolCallId,
        parentSessionPath: ctx.sessionManager?.getSessionFile() ?? undefined,
        onToolActivity: (activity) => {
          if (activity.type === "start") {
            const desc = formatToolCall(activity.toolName, activity.args ?? {});
            m.activity = `→ ${desc}`;
            tree.updateActivity(m.id, `→ ${desc}`);
            emitUpdate();
          }
        },
        onToolOutput: (toolName, delta) => {
          const line = delta.trimEnd().split("\n").filter(Boolean).at(-1) ?? "";
          if (line) {
            m.activity = `${toolName}: ${line}`;
            tree.updateActivity(m.id, `${toolName}: ${line}`);
            emitUpdate();
          }
        },
        onTextDelta: (_delta, fullText) => {
          const preview = fullText.split("\n").filter(Boolean).at(-1) ?? "";
          m.activity = preview;
          m.finalOutput = preview;
          tree.updateActivity(m.id, preview);
          emitUpdate();
        },
        onTurnEnd: (turnCount) => {
          tree.updateActivity(m.id, `turn ${turnCount}`);
        },
        onUsageUpdate: (usage) => {
          tree.updateUsage(m.id, usage);
          m.usage = {
            input: usage.input,
            output: usage.output,
            cacheRead: usage.cacheRead,
            cacheWrite: usage.cacheWrite,
            cost: usage.cost,
            contextTokens: 0,
            turns: 0,
          };
          emitUpdate();
        },
      });

      // Support detach for this minion
      let detachResolve: (() => void) | undefined;

      const detachPromise = new Promise<{
        exitCode: number;
        finalOutput: string;
        usage: UsageStats;
        detached: boolean;
      }>((resolve) => {
        detachResolve = () => {
          detachedMinions.add(m.id);
          resolve({
            exitCode: 0,
            finalOutput: "detached",
            usage: { ...emptyUsage() },
            detached: true,
          });
        };
        detachResolvers.set(m.id, detachResolve);
      });

      // Set up listener to trigger detach
      const unsubscribeThisDetach = detachBus.on(m.id, () => {
        logger.debug("spawn:tool", "minion-detached", {
          id: m.id,
          name: m.name,
          batch: !isSingleMinion,
        });
        detachResolve?.();
      });

      const result = await Promise.race([sessionPromise, detachPromise]);

      unsubscribeThisDetach();

      // Handle detach - check using the detachedMinions set since result might be either type
      if ("detached" in result || detachedMinions.has(m.id)) {
        logger.debug("spawn:tool", "detached", { id: m.id, name: m.name, batch: !isSingleMinion });
        tree.markDetached(m.id);
        m.detached = true; // Mark as detached so it's filtered from foreground display
        const startTime = tree.get(m.id)?.startTime ?? Date.now();
        handleBgCompletion(sessionPromise, m.id, m.name, spec.task, startTime, tree, _queue, pi);
        // Keep status as running since it's now in background
        m.status = "running";
        m.finalOutput = "Moved to background by user";
        emitUpdate(); // Emit update so UI shows detached status
        return {
          success: true,
          result: {
            exitCode: 0,
            finalOutput: `Moved to background by user`,
            usage: tree.get(m.id)?.usage ?? emptyUsage(),
          },
          detached: true,
        };
      }

      // Normal completion - but don't overwrite "aborted" status
      const currentStatus = tree.get(m.id)?.status;
      if (currentStatus !== "aborted") {
        m.status = result.exitCode === 0 ? "completed" : "failed";
        m.finalOutput = result.finalOutput;
        m.usage = result.usage;
        const errorMsg =
          typeof result === "object" && result && "error" in result
            ? String(result.error)
            : undefined;
        tree.updateStatus(m.id, m.status, result.exitCode, errorMsg);
        tree.updateUsage(m.id, result.usage);
        emitUpdate(); // Emit update so UI shows final status
      } else {
        // Minion was aborted - keep the aborted status
        m.status = "aborted";
        m.finalOutput = result.finalOutput;
        emitUpdate(); // Emit update so UI shows aborted status
      }

      if (!isSingleMinion) {
        logger.debug("spawn:tool", "batch-minion-complete", {
          id: m.id,
          name: m.name,
          status: m.status,
          exitCode: result.exitCode,
        });
      }

      return { success: result.exitCode === 0, result };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      m.status = "failed";
      m.finalOutput = msg;
      tree.updateStatus(m.id, "failed", 1, msg);
      logger.error("spawn:tool", isSingleMinion ? "failed" : "batch-minion-failed", {
        id: m.id,
        name: m.name,
        error: msg,
      });
      return { success: false, error: msg };
    }
  });

  // Wait for all to complete (or be detached)
  const results = await Promise.allSettled(sessionPromises);
  completed = true;
  clearInterval(spinnerInterval);

  // Aggregate results
  const anyFailed = results.some((r, idx) => {
    const m = minions[idx];
    // Detached minions are not considered failures
    if (m && detachedMinions.has(m.id)) return false;
    return r.status === "rejected" || !(r.value as { success: boolean }).success;
  });

  // Count completed (non-detached) minions
  const completedCount = minions.filter((m) => m.status === "completed").length;
  const detachedCount = detachedMinions.size;
  const failedCount = minions.filter((m) => m.status === "failed").length;
  const abortedCount = minions.filter((m) => m.status === "aborted").length;

  // Determine final status
  // Priority: aborted > failed > completed > running
  const hasDetached = detachedCount > 0;
  const hasCompletedNonDetached = minions.some(
    (m) => !detachedMinions.has(m.id) && m.status === "completed",
  );

  let finalStatus: AgentStatus;
  if (abortedCount > 0) {
    finalStatus = "aborted";
  } else if (anyFailed) {
    finalStatus = "failed";
  } else if (hasCompletedNonDetached || (!hasDetached && completedCount > 0)) {
    // Completed if there are completed non-detached minions, or if no detachments and some completed
    finalStatus = "completed";
  } else if (hasDetached) {
    // Running if any were detached (they continue in background)
    finalStatus = "running";
  } else {
    finalStatus = "failed";
  }

  // Emit final update
  emitUpdate();

  const firstMinion = minions[0];
  const finalOutput = minions.map((m) => `=== ${m.name} ===\n${m.finalOutput}`).join("\n\n");

  if (isSingleMinion) {
    logger.info("spawn:tool", finalStatus === "completed" ? "completed" : "failed", {
      id: firstMinion.id,
      exitCode: anyFailed ? 1 : 0,
    });
  } else {
    logger.info("spawn:tool", "batch-complete", {
      count: specs.length,
      status: finalStatus,
      succeeded: completedCount,
      detached: detachedCount,
      failed: failedCount,
    });
  }

  // Build result text
  const detachedNames = minions.filter((m) => detachedMinions.has(m.id)).map((m) => m.name);

  let resultText: string;
  if (isSingleMinion) {
    const m = minions[0];
    if (detachedMinions.has(m.id)) {
      resultText = `[USER ACTION] Minion ${m.name} (${m.id}) was moved to background. It is still running and will deliver results when complete.`;
    } else {
      resultText = `Minion ${m.name} (${m.id}) ${finalStatus}.\n\n${finalOutput || "(no output)"}`;
    }
  } else {
    const parts: string[] = [];
    parts.push(`Batch complete: ${completedCount} completed`);
    if (detachedCount > 0) {
      parts.push(`${detachedCount} detached (${detachedNames.join(", ")})`);
    }
    if (failedCount > 0) {
      parts.push(`${failedCount} failed`);
    }
    resultText = `${parts.join(", ")}\n\n${finalOutput}`;
  }

  // Build result
  const result: AgentToolResult<SpawnToolDetails> = {
    content: [{ type: "text", text: resultText }],
    details: {
      id: isSingleMinion ? firstMinion.id : batchId,
      name: isSingleMinion ? firstMinion.name : batchName,
      agentName: isSingleMinion ? firstMinion.agentName : "batch",
      task: isSingleMinion ? firstMinion.task : `batch of ${specs.length} minions`,
      status: finalStatus,
      usage: minions.reduce(
        (acc, m) => ({
          input: acc.input + m.usage.input,
          output: acc.output + m.usage.output,
          cacheRead: acc.cacheRead + m.usage.cacheRead,
          cacheWrite: acc.cacheWrite + m.usage.cacheWrite,
          cost: acc.cost + m.usage.cost,
          contextTokens: acc.contextTokens + m.usage.contextTokens,
          turns: acc.turns + m.usage.turns,
        }),
        emptyUsage(),
      ),
      finalOutput,
      isBatch: true,
      minions: [...minions],
      outputPreviewLines,
      spinnerFrames,
    },
  };

  // Check for aborted status (only for non-detached minions) - must check before anyFailed
  // because an aborted minion will also have failed status
  for (const m of minions) {
    if (detachedMinions.has(m.id)) continue; // Skip detached minions
    const currentNode = tree.get(m.id);
    if (currentNode?.status === "aborted") {
      throw new Error(
        `[HALTED] Minion ${m.name} (${m.id}) was stopped by the user. This is intentional — do NOT retry or re-spawn.`,
      );
    }
  }

  if (anyFailed) {
    if (isSingleMinion) {
      const m = minions[0];
      const errorMsg = m.finalOutput || `exited with error`;
      throw new Error(`Minion ${m.name} (${m.id}) failed: ${errorMsg}`);
    } else {
      const failedNames = minions.filter((m) => m.status === "failed").map((m) => m.name);
      throw new Error(
        `Batch spawn failed. Failed minions: ${failedNames.join(", ")}. Check individual outputs for details.`,
      );
    }
  }

  return result;
}

// Foreground spawn (blocks parent, streams progress)
export function spawn(
  tree: AgentTree,
  queue: ResultQueue,
  pi: ExtensionAPI,
  subsessionManager: SubsessionManager,
) {
  return async function execute(
    _toolCallId: string,
    params: SpawnToolParams,
    signal: AbortSignal | undefined,
    onUpdate: AgentToolUpdateCallback<SpawnToolDetails> | undefined,
    ctx: ExtensionContext,
  ): Promise<AgentToolResult<SpawnToolDetails>> {
    // Validate params - must have either task or tasks, not both
    const hasTask = params.task && typeof params.task === "string" && params.task.length > 0;
    const hasTasks = isBatchParams(params);

    if (hasTask && hasTasks) {
      throw new Error("Cannot specify both 'task' and 'tasks'. Use one or the other.");
    }
    if (!hasTask && !hasTasks) {
      throw new Error("Must specify either 'task' (single) or 'tasks' (batch).");
    }

    // Normalize to specs array - unified handling
    const specs = hasTasks
      ? params.tasks || []
      : [{ task: params.task || "", agent: params.agent, model: params.model }];

    logger.debug("spawn:tool", hasTasks ? "batch-mode" : "single-mode", {
      count: specs.length,
    });

    return executeSpawn(
      specs,
      _toolCallId,
      tree,
      queue,
      pi,
      subsessionManager,
      signal,
      onUpdate,
      ctx,
    );
  };
}

// Background spawn (fire-and-forget, returns immediately)
export function spawnBg(
  tree: AgentTree,
  queue: ResultQueue,
  pi: ExtensionAPI,
  subsessionManager: SubsessionManager,
) {
  return async function execute(
    _toolCallId: string,
    params: SpawnBgToolParams,
    _signal: AbortSignal | undefined,
    onUpdate: AgentToolUpdateCallback<SpawnToolDetails> | undefined,
    ctx: ExtensionContext,
  ): Promise<AgentToolResult<SpawnToolDetails>> {
    const id = generateId();
    const name = pickMinionName(tree, id, ctx);

    const config = resolveConfig(params, name, ctx.cwd);
    const resolvedModel = params.model ?? config.model ?? ctx.model?.id;
    const piConfig = getConfig(ctx);

    logger.info("spawn:tool", "start-bg", {
      id,
      name,
      agent: params.agent ?? "ephemeral",
      task: params.task,
    });

    tree.add(id, name, params.task, undefined, params.agent ?? "ephemeral");
    tree.markDetached(id);

    const controller = new AbortController();
    const startTime = Date.now();

    const sessionPromise = runMinionSession(config, params.task, {
      id,
      name,
      signal: controller.signal,
      modelRegistry: ctx.modelRegistry,
      parentModel: ctx.model,
      cwd: ctx.cwd,
      subsessionManager,
      spawnedBy: _toolCallId,
      parentSessionPath: ctx.sessionManager?.getSessionFile() ?? undefined,
      onToolActivity: (activity) => {
        if (activity.type === "start") {
          tree.updateActivity(id, `→ ${formatToolCall(activity.toolName, activity.args ?? {})}`);
        }
      },
      onToolOutput: (toolName, delta) => {
        const line = delta.trimEnd().split("\n").filter(Boolean).at(-1) ?? "";
        if (line) tree.updateActivity(id, `${toolName}: ${line}`);
      },
      onTextDelta: (_delta, fullText) => {
        const preview = fullText.split("\n").filter(Boolean).at(-1) ?? "";
        tree.updateActivity(id, preview);
      },
      onTurnEnd: (turnCount) => {
        tree.updateActivity(id, `turn ${turnCount}`);
      },
      onUsageUpdate: (usage) => {
        tree.updateUsage(id, usage);
      },
    });

    logger.debug("spawn:bg", "calling-handleBgCompletion", {
      id,
      name,
      hasPi: !!pi,
      hasSendMessage: !!pi.sendMessage,
    });
    handleBgCompletion(sessionPromise, id, name, params.task, startTime, tree, queue, pi);
    logger.debug("spawn:bg", "handleBgCompletion-returned", { id });

    const result: AgentToolResult<SpawnToolDetails> = {
      content: [
        {
          type: "text",
          text: `Spawned ${name} (${id}) in background. Results will be delivered when complete.`,
        },
      ],
      details: {
        id,
        name,
        agentName: params.agent ?? config.name,
        task: params.task,
        status: "running",
        usage: emptyUsage(),
        model: resolvedModel,
        finalOutput: `Spawned in background`,
        outputPreviewLines: piConfig.display.outputPreviewLines,
        spinnerFrames: piConfig.display.spinnerFrames,
      },
    };

    onUpdate?.(result);
    return result;
  };
}
