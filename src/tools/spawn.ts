import { Type } from "@sinclair/typebox";
import type { Static } from "@sinclair/typebox";
import type { AgentToolResult, AgentToolUpdateCallback } from "@mariozechner/pi-coding-agent";
import type { ExtensionContext, ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { discoverAgents } from "../agents.js";
import { runMinionSession } from "../spawn.js";
import type { MinionSession } from "../spawn.js";
import { formatToolCall } from "../render.js";
import { AgentTree } from "../tree.js";
import { generateId, pickMinionName, defaultMinionTemplate } from "../minions.js";
import { logger } from "../logger.js";
import type { ResultQueue } from "../queue.js";
import type { AgentConfig, UsageStats } from "../types.js";
import { emptyUsage } from "../types.js";

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

/** Stored in detachHandles so /minions bg can detach a foreground spawn. */
export interface DetachHandle {
  resolve: () => void;
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
      logger.warn("spawn:tool", "agent not found", { requested: params.agent, available });
      throw new Error(`Agent "${params.agent}" not found. Available: ${available}`);
    }
    return found;
  }
  return defaultMinionTemplate(name, { model: params.model });
}

// Background activity callbacks (shared by spawn_bg and detach)
function createBgCallbacks(tree: AgentTree, id: string) {
  return {
    onToolActivity: (activity: { type: "start" | "end"; toolName: string }) => {
      if (activity.type === "start") tree.updateActivity(id, `→ ${activity.toolName}`);
    },
    onToolOutput: (toolName: string, delta: string) => {
      // Extract last non-empty line, truncate to 80 chars for activity preview
      const line = delta.trimEnd().split("\n").filter(Boolean).at(-1)?.slice(0, 80) ?? "";
      if (line) tree.updateActivity(id, `${toolName}: ${line}`);
    },
    onTextDelta: (_delta: string, fullText: string) => {
      const preview = fullText.split("\n").filter(Boolean).at(-1)?.slice(0, 80) ?? "";
      tree.updateActivity(id, preview);
    },
    onTurnEnd: (turnCount: number) => { tree.updateActivity(id, `turn ${turnCount}`); },
  };
}

// Background completion handler (shared by spawn_bg and detach)
function handleBgCompletion(
  sessionPromise: Promise<import("../types.js").SpawnResult>,
  id: string, name: string, task: string, startTime: number,
  tree: AgentTree, handles: Map<string, AbortController>,
  queue: ResultQueue, pi: ExtensionAPI,
): void {
  void sessionPromise.then((result) => {
    const status = result.exitCode === 0 ? "completed" : "failed";
    tree.updateStatus(id, status, result.exitCode, result.error);
    tree.updateUsage(id, result.usage);
    handles.delete(id);

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
    handles.delete(id);
    logger.error("spawn:tool", "bg-failed", { id, name, error: msg });
  });
}

// Foreground spawn (blocks parent, streams progress)
export function spawn(
  tree: AgentTree,
  handles: Map<string, AbortController>,
  detachHandles: Map<string, DetachHandle>,
  queue: ResultQueue,
  pi: ExtensionAPI,
  sessions: Map<string, MinionSession>,
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

    const controller = new AbortController();
    handles.set(id, controller);

    // Detach handle: resolves when /minions bg is called, racing against session completion.
    // Must be set up BEFORE tree.add so tree.onChange correctly filters this as foreground.
    let detachResolve: (() => void) | undefined;
    const detachPromise = new Promise<void>((resolve) => {
      detachResolve = resolve;
    });
    detachHandles.set(id, { resolve: detachResolve! });

    tree.add(id, name, params.task);

    let signalCleanup: (() => void) | undefined;
    if (signal) {
      const onAbort = () => controller.abort();
      if (signal.aborted) {
        controller.abort();
      } else {
        signal.addEventListener("abort", onAbort, { once: true });
        signalCleanup = () => signal.removeEventListener("abort", onAbort);
      }
    }

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

    const spinnerInterval = setInterval(() => { spinnerFrame++; emitUpdate(); }, 80);
    let detached = false;

    try {
      const sessionPromise = runMinionSession(config, params.task, {
        id, name,
        signal: controller.signal,
        modelRegistry: ctx.modelRegistry,
        parentModel: ctx.model,
        cwd: ctx.cwd,
        sessions,
        parentSystemPrompt: ctx.getSystemPrompt(),
        onToolActivity: (activity) => {
          if (activity.type === "start") {
            const desc = formatToolCall(activity.toolName, {});
            emitUpdate({ activity: `→ ${desc}` });
            tree.updateActivity(id, `→ ${desc}`);
          }
        },
        onToolOutput: (toolName, delta) => {
          // Last non-empty line, truncated for preview
          const line = delta.trimEnd().split("\n").filter(Boolean).at(-1)?.slice(0, 80) ?? "";
          if (line) {
            emitUpdate({ activity: `${toolName}: ${line}` });
            tree.updateActivity(id, `${toolName}: ${line}`);
          }
        },
        onTextDelta: (_delta, fullText) => {
          const preview = fullText.split("\n").filter(Boolean).at(-1)?.slice(0, 80) ?? "";
          emitUpdate({ activity: preview, finalOutput: preview });
          tree.updateActivity(id, preview);
        },
        onTurnEnd: (turnCount) => {
          tree.updateActivity(id, `turn ${turnCount}`);
        },
      });

      const raceResult = await Promise.race([
        sessionPromise.then((r) => ({ type: "completed" as const, result: r })),
        detachPromise.then(() => ({ type: "detached" as const })),
      ]);

      if (raceResult.type === "detached") {
        detached = true;
        signalCleanup?.();
        signalCleanup = undefined;

        const startTime = tree.get(id)?.startTime ?? Date.now();
        handleBgCompletion(sessionPromise, id, name, params.task, startTime, tree, handles, queue, pi);

        logger.debug("spawn:tool", "detached", { id, name });
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

      const result = raceResult.result;
      const currentNode = tree.get(id);

      // Check tree node for "aborted" first — external /halt sets the tree status
      // before session.prompt() resolves, so the result alone can't distinguish halt from error
      const status = currentNode?.status === "aborted"
        ? "aborted"
        : result.exitCode === 0 ? "completed" : "failed";

      if (status !== "aborted") {
        logger.info("spawn:tool", status, { id, exitCode: result.exitCode, outputLen: result.finalOutput.length });
        tree.updateStatus(id, status, result.exitCode, result.error);
      }

      tree.updateUsage(id, result.usage);

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
        throw new Error(`Minion ${name} (${id}) failed: ${result.error ?? `exited with code ${result.exitCode}`}`);
      }

      return {
        content: [{ type: "text", text: `Minion ${name} (${id}) completed.\n\n${result.finalOutput || "(no output)"}` }],
        details,
      };
    } finally {
      clearInterval(spinnerInterval);
      detachHandles.delete(id);
      signalCleanup?.();
      if (!detached) handles.delete(id);
    }
  };
}

// Background spawn (fire-and-forget, returns immediately)
export function spawnBg(
  tree: AgentTree,
  handles: Map<string, AbortController>,
  queue: ResultQueue,
  pi: ExtensionAPI,
  sessions: Map<string, MinionSession>,
) {
  return async function execute(
    _toolCallId: string,
    params: SpawnBgToolParams,
    _signal: AbortSignal | undefined,
    _onUpdate: unknown,
    ctx: ExtensionContext,
  ): Promise<AgentToolResult<SpawnToolDetails>> {
    const id = generateId();
    const name = pickMinionName(tree, id);
    const config = resolveConfig(params, name, ctx.cwd);
    logger.info("spawn:tool", "start-bg", { id, name, agent: params.agent ?? "ephemeral", task: params.task });

    const controller = new AbortController();
    handles.set(id, controller);
    tree.add(id, name, params.task);

    const startTime = Date.now();
    const sessionPromise = runMinionSession(config, params.task, {
      id, name,
      signal: controller.signal,
      modelRegistry: ctx.modelRegistry,
      parentModel: ctx.model,
      cwd: ctx.cwd,
      sessions,
      parentSystemPrompt: ctx.getSystemPrompt(),
      ...createBgCallbacks(tree, id),
    });

    handleBgCompletion(sessionPromise, id, name, params.task, startTime, tree, handles, queue, pi);

    return {
      content: [{ type: "text", text: `Spawned ${name} (${id}) in background. Results will be delivered when complete.` }],
      details: {
        id, name, agentName: params.agent ?? config.name, task: params.task,
        status: "running", usage: emptyUsage(),
        model: params.model ?? config.model,
        finalOutput: `Spawned in background`,
      },
    };
  };
}
