import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { discoverAgents } from "../agents.js";
import { logger } from "../logger.js";
import { defaultMinionTemplate } from "../minions.js";
import type { ResultQueue } from "../queue.js";
import { formatToolCall } from "../render.js";
import { runMinionSession } from "../spawn.js";
import type { SubsessionManager } from "../subsessions/manager.js";
import type { BatchMinionItem } from "../tools/spawn.js";
import type { AgentTree } from "../tree.js";
import type { AgentConfig, UsageStats } from "../types.js";
import { emptyUsage } from "../types.js";
import type { BatchCoordinator } from "./batch.js";
import { handleCompletion } from "./completion.js";
import { onDetach } from "./detach.js";

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

export async function runSingleMinion(opts: {
  spec: { task: string; agent?: string; model?: string };
  m: BatchMinionItem;
  isSingleMinion: boolean;
  toolCallId: string;
  controller: AbortController;
  detachedMinions: Set<string>;
  detachResolvers: Map<string, () => void>;
  tree: AgentTree;
  queue: ResultQueue;
  pi: ExtensionAPI;
  ctx: ExtensionContext;
  piConfig: {
    toolSync: { enabled: boolean; maxWait: number };
    interaction: { timeout: number };
  };
  parentToolNames: string[];
  subsessionManager: SubsessionManager;
  coordinator: BatchCoordinator;
}): Promise<{
  success: boolean;
  result?: import("../types.js").SpawnResult;
  error?: string;
  detached?: boolean;
}> {
  const {
    spec,
    m,
    isSingleMinion,
    toolCallId,
    controller,
    detachedMinions,
    detachResolvers,
    tree,
    queue,
    pi,
    ctx,
    piConfig,
    parentToolNames,
    subsessionManager,
    coordinator,
  } = opts;

  const config = spec.agent
    ? resolveAgentConfig(spec.agent, ctx.cwd)
    : defaultMinionTemplate(m.name, { model: spec.model });

  coordinator.emit(true);

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
      parentToolNames,
      toolSyncEnabled: piConfig.toolSync.enabled,
      toolSyncMaxWait: piConfig.toolSync.maxWait * 1000,
      interactionTimeout: piConfig.interaction.timeout * 1000,
      tree,
      onToolActivity: (activity) => {
        if (activity.type === "start") {
          const desc = formatToolCall(activity.toolName, activity.args ?? {});
          m.activity = `→ ${desc}`;
          tree.logActivity(m.id, `→ ${desc}`);
          coordinator.emit(true);
        }
      },
      onToolOutput: (toolName, delta) => {
        const line = delta.trimEnd().split("\n").filter(Boolean).at(-1) ?? "";
        if (line) {
          m.activity = `${toolName}: ${line}`;
          tree.updateActivity(m.id, `${toolName}: ${line}`);
          coordinator.emit(true);
        }
      },
      onTextDelta: (_delta, fullText) => {
        const preview = fullText.split("\n").filter(Boolean).at(-1) ?? "";
        m.activity = preview;
        m.finalOutput = preview;
        tree.updateActivity(m.id, preview);
        coordinator.emit(true);
      },
      onTurnEnd: (turnCount) => {
        tree.logActivity(m.id, `turn ${turnCount}`);
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
        coordinator.emit(true);
      },
    });

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

    const unsubscribeThisDetach = onDetach(m.id, () => {
      logger.debug("spawn:tool", "minion-detached", {
        id: m.id,
        name: m.name,
        batch: !isSingleMinion,
      });
      detachResolve?.();
    });

    const result = await Promise.race([sessionPromise, detachPromise]);

    unsubscribeThisDetach();

    if ("detached" in result || detachedMinions.has(m.id)) {
      logger.debug("spawn:tool", "detached", {
        id: m.id,
        name: m.name,
        batch: !isSingleMinion,
      });
      tree.markDetached(m.id);
      m.detached = true;
      const startTime = tree.get(m.id)?.startTime ?? Date.now();
      handleCompletion(sessionPromise, m.id, m.name, spec.task, startTime, tree, queue, pi);
      m.status = "running";
      m.finalOutput = "Moved to background by user";
      coordinator.emit(true);
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
      coordinator.emit(true);
    } else {
      m.status = "aborted";
      m.finalOutput = result.finalOutput;
      coordinator.emit(true);
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
}
