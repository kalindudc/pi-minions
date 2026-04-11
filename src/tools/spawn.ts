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
import { BatchCoordinator, handleCompletion, runSingleMinion } from "../spawn/index.js";
import { runMinionSession } from "../spawn.js";
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
  // Attach mode - bring existing background minions to foreground
  ids: Type.Optional(
    Type.Array(Type.String(), {
      minItems: 1,
      description:
        "Array of minion IDs or names to bring to foreground (use this OR task/tasks, not both)",
    }),
  ),
});
export type SpawnToolParams = Static<typeof SpawnToolParams>;

// Type guard for batch detection
function isBatchParams(params: SpawnToolParams): boolean {
  return "tasks" in params && Array.isArray(params.tasks) && params.tasks.length > 0;
}

// Type guard for attach mode
function isAttachParams(params: SpawnToolParams): boolean {
  return "ids" in params && Array.isArray(params.ids) && params.ids.length > 0;
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

// Config resolution for named agents only
function resolveAgentConfig(agentName: string, cwd: string): AgentConfig {
  const { agents } = discoverAgents(cwd, "both");
  const found = agents.find((a) => a.name === agentName);

  if (!found) {
    const available = agents.map((a) => a.name).join(", ") || "none";
    logger.warn("spawn:tool", "agent not found", {
      requested: agentName,
      available,
    });
    throw new Error(`Agent "${agentName}" not found. Available: ${available}`);
  }

  return found;
}

export { detachMinion } from "../spawn/index.js";

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
  const piConfig = getConfig(ctx);
  const spinnerFrames = piConfig.display.spinnerFrames;
  const outputPreviewLines = piConfig.display.outputPreviewLines;

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

  // Collect parent tool names for diagnostic comparison in minion sessions
  const parentToolNames = pi.getAllTools().map((t) => t.name);

  // Create minion items - track assigned names to ensure uniqueness
  const assignedNames = new Set<string>();

  const minions: BatchMinionItem[] = specs.map((spec) => {
    const id = generateId();
    const agentConfig = spec.agent ? resolveAgentConfig(spec.agent, ctx.cwd) : undefined;

    const name = pickMinionName(tree, id, ctx, agentConfig?.displayName, assignedNames);
    assignedNames.add(name);

    const config = agentConfig ?? defaultMinionTemplate(name, { model: spec.model });
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

  const batchId = generateId();
  const batchName = isSingleMinion ? minions[0].name : `batch-${batchId.slice(0, 8)}`;
  const coordinator = new BatchCoordinator({
    minions,
    isSingleMinion,
    batchId,
    batchName,
    batchTask: isSingleMinion ? minions[0].task : `batch of ${specs.length} minions`,
    outputPreviewLines,
    spinnerFrames,
    onUpdate,
  });
  coordinator.start();

  // Track detached minions
  const detachedMinions = new Set<string>();
  const detachResolvers = new Map<string, () => void>();

  const sessionPromises = minions.map((m, index) => {
    const spec = specs[index];
    if (!spec) {
      throw new Error(`No spec found for minion at index ${index}`);
    }
    return runSingleMinion({
      spec,
      m,
      isSingleMinion,
      toolCallId,
      controller,
      detachedMinions,
      detachResolvers,
      tree,
      queue: _queue,
      pi,
      ctx,
      piConfig,
      parentToolNames,
      subsessionManager,
      coordinator,
    });
  });

  const results = await Promise.allSettled(sessionPromises);
  coordinator.stop();

  const anyFailed = results.some((r, idx) => {
    const m = minions[idx];
    if (m && detachedMinions.has(m.id)) return false;
    return r.status === "rejected" || !(r.value as { success: boolean }).success;
  });
  const completedCount = minions.filter((m) => m.status === "completed").length;
  const detachedCount = detachedMinions.size;
  const failedCount = minions.filter((m) => m.status === "failed").length;
  const finalStatus = coordinator.getStatus(detachedMinions);
  coordinator.emit(true);

  const firstMinion = minions[0];
  const finalOutput = coordinator.getOutput();

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

// Attach to existing background minions and bring them to foreground
async function executeAttach(
  ids: string[],
  _toolCallId: string,
  tree: AgentTree,
  queue: ResultQueue,
  _pi: ExtensionAPI,
  signal: AbortSignal | undefined,
  onUpdate: AgentToolUpdateCallback<SpawnToolDetails> | undefined,
  ctx: ExtensionContext,
): Promise<AgentToolResult<SpawnToolDetails>> {
  const piConfig = getConfig(ctx);
  const spinnerFrames = piConfig.display.spinnerFrames;
  const outputPreviewLines = piConfig.display.outputPreviewLines;

  logger.info("spawn:tool", "attach-start", { count: ids.length, ids });

  // Resolve minions from IDs/names
  const minions: BatchMinionItem[] = [];
  for (const idOrName of ids) {
    const node = tree.resolve(idOrName);
    if (!node) {
      throw new Error(`Minion not found: ${idOrName}`);
    }
    if (node.status !== "running") {
      throw new Error(`Minion ${node.name} is not running (status: ${node.status})`);
    }
    minions.push({
      id: node.id,
      name: node.name,
      agentName: node.agentName ?? "ephemeral",
      task: node.task,
      status: node.status,
      usage: { ...node.usage },
      model: undefined,
      finalOutput: "",
      activity: tree.get(node.id)?.lastActivity ?? "attaching...",
      spinnerFrame: 0,
    });
  }

  const isSingleMinion = minions.length === 1;
  const batchId = generateId();
  const batchName = isSingleMinion ? minions[0].name : `batch-${batchId.slice(0, 8)}`;

  logger.debug("spawn:tool", "attach-minions", {
    count: minions.length,
    names: minions.map((m) => m.name),
  });

  // Mark all as foregrounded and attached
  for (const m of minions) {
    tree.markAttached(m.id);
    tree.markForegrounded(m.id);
    logger.debug("spawn:tool", "attach-marked", { id: m.id, name: m.name });
  }

  const coordinator = new BatchCoordinator({
    minions,
    isSingleMinion,
    batchId,
    batchName: isSingleMinion ? minions[0].name : `batch-${batchId.slice(0, 8)}`,
    batchTask: isSingleMinion ? minions[0].task : `attached batch of ${ids.length} minions`,
    outputPreviewLines,
    spinnerFrames,
    onUpdate,
  });
  const unsubscribeTree = tree.onChange(() => {
    for (const m of minions) {
      const node = tree.get(m.id);
      if (node) {
        m.status = node.status;
        m.usage = { ...node.usage };
        m.finalOutput = node.lastActivity ?? m.finalOutput;
        m.activity = node.lastActivity ?? m.activity;
      }
    }
    coordinator.emit(true);
  });
  coordinator.start();

  // Wait for all minions to complete
  try {
    await new Promise<void>((resolve, reject) => {
      // Check completion via tree changes
      const checkInterval = setInterval(() => {
        const allDone = minions.every((m) => {
          const node = tree.get(m.id);
          return node && node.status !== "running";
        });
        if (allDone) {
          clearInterval(checkInterval);
          resolve();
        }
      }, 100);

      // Handle abort signal
      if (signal) {
        const onAbort = () => {
          clearInterval(checkInterval);
          reject(new Error("Aborted"));
        };
        if (signal.aborted) {
          onAbort();
        } else {
          signal.addEventListener("abort", onAbort, { once: true });
        }
      }
    });
  } finally {
    coordinator.stop();
    unsubscribeTree();
  }

  const finalResults = minions.map((m) => {
    const node = tree.get(m.id);
    const result = queue.get(m.id);
    return {
      ...m,
      status: node?.status ?? m.status,
      finalOutput: result?.output ?? m.finalOutput,
      usage: result?.usage ?? m.usage,
    };
  });

  const finalStatus = coordinator.getStatus();
  const totalUsage = coordinator.getUsage();
  const finalOutput = coordinator.getOutput();

  // Build result text
  const resultText = isSingleMinion
    ? `Minion ${finalResults[0].name} (${finalResults[0].id}) ${finalStatus}.\n\n${finalOutput || "(no output)"}`
    : `Batch complete: ${finalResults.filter((m) => m.status === "completed").length} completed\n\n${finalOutput}`;

  const result: AgentToolResult<SpawnToolDetails> = {
    content: [{ type: "text", text: resultText }],
    details: {
      id: isSingleMinion ? finalResults[0].id : batchId,
      name: isSingleMinion ? finalResults[0].name : batchName,
      agentName: isSingleMinion ? finalResults[0].agentName : "batch",
      task: isSingleMinion ? finalResults[0].task : `attached batch of ${ids.length} minions`,
      status: finalStatus,
      usage: totalUsage,
      finalOutput,
      isBatch: true,
      minions: finalResults,
      outputPreviewLines,
      spinnerFrames,
    },
  };

  logger.info("spawn:tool", "attach-complete", {
    count: minions.length,
    status: finalStatus,
  });

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
    // Check for attach mode first (ids parameter)
    if (isAttachParams(params)) {
      logger.debug("spawn:tool", "attach-mode", { count: params.ids?.length });
      return executeAttach(params.ids ?? [], _toolCallId, tree, queue, pi, signal, onUpdate, ctx);
    }

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
    const agentConfig = params.agent ? resolveAgentConfig(params.agent, ctx.cwd) : undefined;
    const name = pickMinionName(tree, id, ctx, agentConfig?.displayName);
    const config = agentConfig ?? defaultMinionTemplate(name, { model: params.model });

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
      parentToolNames: pi.getAllTools().map((t) => t.name),
      toolSyncEnabled: piConfig.toolSync.enabled,
      toolSyncMaxWait: piConfig.toolSync.maxWait * 1000,
      interactionTimeout: piConfig.interaction.timeout * 1000,
      onToolActivity: (activity) => {
        if (activity.type === "start") {
          tree.logActivity(id, `→ ${formatToolCall(activity.toolName, activity.args ?? {})}`);
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
        tree.logActivity(id, `turn ${turnCount}`);
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
    handleCompletion(sessionPromise, id, name, params.task, startTime, tree, queue, pi);
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
