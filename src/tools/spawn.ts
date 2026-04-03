import { Type } from "@sinclair/typebox";
import type { Static } from "@sinclair/typebox";
import type { AgentToolResult, AgentToolUpdateCallback } from "@mariozechner/pi-coding-agent";
import type { ExtensionContext, ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { discoverAgents } from "../agents.js";
import { runMinionSession } from "../spawn.js";
import { formatToolCall } from "../render.js";
import { AgentTree } from "../tree.js";
import { generateId, pickMinionName, defaultMinionTemplate } from "../minions.js";
import { logger } from "../logger.js";
import type { ResultQueue } from "../queue.js";
import type { AgentConfig, UsageStats } from "../types.js";
import { emptyUsage } from "../types.js";
import type { SubsessionManager } from "../subsessions/manager.js";
import { EventBus } from "../subsessions/event-bus.js";

// Parameter schemas
const baseParams = {
  agent: Type.Optional(Type.String({
    description: "Name of the agent to invoke. If omitted, spawns an ephemeral minion with default capabilities.",
  })),
  task: Type.String({ description: "Task to delegate to the agent" }),
  model: Type.Optional(Type.String({ description: "Override the agent's model" })),
};

export const SpawnToolParams = Type.Object(baseParams);
export type SpawnToolParams = Static<typeof SpawnToolParams>;

export const SpawnBgToolParams = Type.Object(baseParams);
export type SpawnBgToolParams = Static<typeof SpawnBgToolParams>;

// Types
export interface SpawnToolDetails {
  id: string;
  name: string;
  agentName: string;
  task: string;
  status: string;
  usage: UsageStats;
  model?: string;
  finalOutput: string;
  activity?: string;
  spinnerFrame?: number;
}

/** Signal for detaching a foreground minion */
export type DetachSignal = { id: string; resolve: () => void };

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
      logger.warn("spawn:tool", "agent not found", { requested: params.agent, available });
      throw new Error(`Agent "${params.agent}" not found. Available: ${available}`);
    }
    return found;
  }
  return defaultMinionTemplate(name, { model: params.model });
}

// Activity callbacks for tree updates
function createActivityCallbacks(tree: AgentTree, id: string) {
  return {
    onToolActivity: (activity: { type: "start" | "end"; toolName: string; args?: Record<string, unknown> }) => {
      if (activity.type === "start") {
        const desc = formatToolCall(activity.toolName, activity.args ?? {});
        tree.updateActivity(id, `→ ${desc}`);
      }
    },
    onToolOutput: (_toolName: string, delta: string) => {
      const line = delta.trimEnd().split("\n").filter(Boolean).at(-1) ?? "";
      if (line) tree.updateActivity(id, `← ${line}`);
    },
    onTextDelta: (_delta: string, fullText: string) => {
      // Show full last line without truncation to avoid cutting sentences
      const preview = fullText.split("\n").filter(Boolean).at(-1) ?? "";
      tree.updateActivity(id, preview);
    },
    onTurnEnd: (turnCount: number) => { tree.updateActivity(id, `turn ${turnCount}`); },
  };
}

// Handle background completion
function handleBgCompletion(
  sessionPromise: Promise<import("../types.js").SpawnResult>,
  id: string, name: string, task: string, startTime: number,
  tree: AgentTree, queue: ResultQueue, pi: ExtensionAPI,
): void {
  void sessionPromise.then((result) => {
    const status = result.exitCode === 0 ? "completed" : "failed";
    tree.updateStatus(id, status, result.exitCode, result.error);
    tree.updateUsage(id, result.usage);

    queue.add({
      id, name, task,
      output: result.finalOutput, usage: result.usage,
      status: "pending", completedAt: Date.now(),
      duration: Date.now() - startTime,
      exitCode: result.exitCode, error: result.error,
    });

    const messageContent = [
      `Background minion "${name}" (${id}) completed.`,
      `Task: ${task}`,
      `Exit code: ${result.exitCode}`,
      ...(result.error ? [`Error: ${result.error}`] : []),
      ``, result.finalOutput,
    ].join("\n");

    pi.sendUserMessage(messageContent, { deliverAs: "followUp" });
    queue.accept(id);
    logger.info("spawn:tool", "bg-completed", { id, name, exitCode: result.exitCode });
  }).catch((err) => {
    const msg = err instanceof Error ? err.message : String(err);
    tree.updateStatus(id, "failed", 1, msg);
    logger.error("spawn:tool", "bg-failed", { id, name, error: msg });
  });
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

/** Check if a minion is foreground (can be detached) */
export function isForeground(id: string, subsessionManager: SubsessionManager): boolean {
  // A minion is foreground if it's running and we're actively waiting on it
  // This is tracked by checking if the session exists and is running
  const session = subsessionManager.getSession(id);
  const metadata = subsessionManager.getMetadata(id);
  return session !== undefined && metadata?.status === "running";
}

/** Detach a foreground minion */
export function detachMinion(id: string): void {
  detachBus.emit(id);
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
    const id = generateId();
    const name = pickMinionName(tree, id);
    const config = resolveConfig(params, name, ctx.cwd);
    logger.info("spawn:tool", "start", { id, name, agent: params.agent ?? "ephemeral", task: params.task });

    tree.add(id, name, params.task);

    // Track UI state
    let lastActivity: string | undefined;
    let lastOutput = "";
    let spinnerFrame = 0;

    const emitUpdate = (partial?: Partial<SpawnToolDetails>) => {
      if (partial?.activity !== undefined) lastActivity = partial.activity;
      if (partial?.finalOutput !== undefined) lastOutput = partial.finalOutput;

      const node = tree.get(id);
      onUpdate?.({
        content: [{ type: "text", text: lastOutput }],
        details: {
          id, name, agentName: params.agent ?? config.name, task: params.task,
          status: node?.status ?? "running",
          usage: node?.usage ?? emptyUsage(),
          model: params.model ?? config.model,
          finalOutput: lastOutput,
          activity: lastActivity,
          spinnerFrame,
        },
      });
    };

    const spinnerInterval = setInterval(() => { spinnerFrame++; emitUpdate(); }, 100);

    // Create abort controller for this session
    const controller = new AbortController();

    // Wire parent's abort signal
    if (signal) {
      const onAbort = () => controller.abort();
      if (signal.aborted) {
        controller.abort();
      } else {
        signal.addEventListener("abort", onAbort, { once: true });
      }
    }

    // Set up detach listener - uses separate mechanism from abort
    let detached = false;
    let detachResolve: (() => void) | undefined;
    const detachPromise = new Promise<void>((resolve) => {
      detachResolve = resolve;
    });
    const unsubscribeDetach = detachBus.on(id, () => {
      if (!detached) {
        detached = true;
        detachResolve?.();
        // Note: We do NOT abort the controller here - the session continues running
      }
    });

    try {
      const sessionPromise = runMinionSession(config, params.task, {
        id, name,
        signal: controller.signal,
        modelRegistry: ctx.modelRegistry,
        parentModel: ctx.model,
        cwd: ctx.cwd,
        subsessionManager,
        spawnedBy: _toolCallId,
        parentSessionPath: ctx.sessionManager?.getSessionFile() ?? undefined,
        onToolActivity: (activity) => {
          if (activity.type === "start") {
            const desc = formatToolCall(activity.toolName, activity.args ?? {});
            emitUpdate({ activity: `→ ${desc}` });
            tree.updateActivity(id, `→ ${desc}`);
          }
        },
        onToolOutput: (toolName, delta) => {
          const line = delta.trimEnd().split("\n").filter(Boolean).at(-1) ?? "";
          if (line) {
            emitUpdate({ activity: `${toolName}: ${line}` });
            tree.updateActivity(id, `${toolName}: ${line}`);
          }
        },
        onTextDelta: (_delta, fullText) => {
          // Show full last line without truncation to avoid cutting sentences
          const preview = fullText.split("\n").filter(Boolean).at(-1) ?? "";
          emitUpdate({ activity: preview, finalOutput: preview });
          tree.updateActivity(id, preview);
        },
        onTurnEnd: (turnCount) => {
          tree.updateActivity(id, `turn ${turnCount}`);
        },
        // Activity callbacks are defined above inline
      });

      // Wait for either session completion OR detach signal
      const result = await Promise.race([
        sessionPromise,
        detachPromise.then(() => ({ exitCode: 0, finalOutput: "detached", usage: { ...emptyUsage() }, detached: true })),
      ]);

      // If detached, set up background completion handling and return
      if (detached || ('detached' in result && result.detached)) {
        logger.debug("spawn:tool", "detached", { id, name });
        // Mark the minion as detached in the tree (updates foreground/background status)
        tree.markDetached(id);
        // Set up background completion handling
        const startTime = tree.get(id)?.startTime ?? Date.now();
        handleBgCompletion(sessionPromise, id, name, params.task, startTime, tree, queue, pi);
        // Emit final update to refresh sibling minions' UI immediately
        emitUpdate({ finalOutput: `Moved to background by user` });
        return {
          content: [{ type: "text", text: `[USER ACTION] The user moved minion ${name} (${id}) to background via /minions bg. The minion is still running and will deliver its result when complete. Continue with other tasks.` }],
          details: {
            id, name, agentName: params.agent ?? config.name, task: params.task,
            status: "running", usage: tree.get(id)?.usage ?? emptyUsage(),
            model: params.model ?? config.model,
            finalOutput: `Moved to background by user`,
          },
        };
      }

      // Normal completion (completed, failed, or aborted)
      const currentNode = tree.get(id);
      const status = currentNode?.status === "aborted"
        ? "aborted"
        : result.exitCode === 0 ? "completed" : "failed";

      if (status !== "aborted") {
        logger.info("spawn:tool", status, { id, exitCode: result.exitCode, outputLen: result.finalOutput.length });
        tree.updateStatus(id, status, result.exitCode, (result as any).error);
      }

      tree.updateUsage(id, result.usage);

      // ALWAYS emit final update to refresh sibling minions' UI immediately
      // This must happen before returning or throwing so siblings re-render
      emitUpdate({ finalOutput: result.finalOutput });

      const node = tree.get(id);
      const details: SpawnToolDetails = {
        id, name, agentName: params.agent ?? config.name, task: params.task,
        status, usage: node?.usage ?? result.usage,
        model: params.model ?? config.model,
        finalOutput: result.finalOutput,
      };

      if (status === "aborted") {
        throw new Error(`[HALTED] Minion ${name} (${id}) was stopped by the user. This is intentional — do NOT retry or re-spawn.`);
      }
      if (result.exitCode !== 0) {
        throw new Error(`Minion ${name} (${id}) failed: ${(result as any).error ?? `exited with code ${result.exitCode}`}`);
      }

      return {
        content: [{ type: "text", text: `Minion ${name} (${id}) completed.\n\n${result.finalOutput || "(no output)"}` }],
        details,
      };
    } finally {
      clearInterval(spinnerInterval);
      unsubscribeDetach();
    }
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
    const name = pickMinionName(tree, id);
    const config = resolveConfig(params, name, ctx.cwd);
    logger.info("spawn:tool", "start-bg", { id, name, agent: params.agent ?? "ephemeral", task: params.task });

    tree.add(id, name, params.task);
    // Mark as detached immediately since this is a background spawn
    tree.markDetached(id);

    const controller = new AbortController();
    const startTime = Date.now();

    // Start the session without awaiting - truly fire-and-forget
    // We use void to explicitly ignore the promise and prevent unhandled rejection warnings
    const sessionPromise = runMinionSession(config, params.task, {
      id, name,
      signal: controller.signal,
      modelRegistry: ctx.modelRegistry,
      parentModel: ctx.model,
      cwd: ctx.cwd,
      subsessionManager,
      spawnedBy: _toolCallId,
      parentSessionPath: ctx.sessionManager?.getSessionFile() ?? undefined,
      ...createActivityCallbacks(tree, id),
    });

    // Set up completion handling but don't await the promise
    handleBgCompletion(sessionPromise, id, name, params.task, startTime, tree, queue, pi);

    const result: AgentToolResult<SpawnToolDetails> = {
      content: [{ type: "text", text: `Spawned ${name} (${id}) in background. Results will be delivered when complete.` }],
      details: {
        id, name, agentName: params.agent ?? config.name, task: params.task,
        status: "running", usage: emptyUsage(),
        model: params.model ?? config.model,
        finalOutput: `Spawned in background`,
      },
    };

    onUpdate?.(result);
    return result;
  };
}
