import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { AgentTree } from "./tree.js";
import { ResultQueue } from "./queue.js";
import { SpawnToolParams, SpawnBgToolParams, makeSpawnExecute, makeSpawnBgExecute } from "./tools/spawn.js";
import type { DetachHandle } from "./tools/spawn.js";
import type { MinionSession } from "./spawn.js";
import { HaltToolParams, makeHaltExecute } from "./tools/halt.js";
import { ListAgentsParams, makeListAgentsExecute } from "./tools/list-agents.js";
import {
  ListMinionsParams, makeListMinionsExecute,
  SteerMinionParams, makeSteerMinionExecute,
  ShowMinionParams, makeShowMinionExecute,
} from "./tools/minions.js";
import { makeSpawnHandler } from "./commands/spawn.js";
import { makeHaltHandler } from "./commands/halt.js";
import { makeMinionsHandler } from "./commands/minions.js";
import { renderCall, renderResult } from "./render.js";
import { logger, LOG_FILE } from "./logger.js";

export default function (pi: ExtensionAPI): void {
  logger.debug("extension", "loaded", { logFile: LOG_FILE });

  const tree = new AgentTree();
  const handles = new Map<string, AbortController>();
  const queue = new ResultQueue();
  const detachHandles = new Map<string, DetachHandle>();
  const sessions = new Map<string, MinionSession>();

  pi.registerTool({
    name: "spawn",
    label: "Spawn Minion",
    description:
      "Delegate a task to a named agent or an ephemeral minion with isolated context. " +
      "If no agent name is provided, spawns an ephemeral minion with default capabilities. " +
      "Agents are discovered from ~/.pi/agent/agents/ and .pi/agents/. " +
      "The agent runs as an in-process session with its own context window.",
    promptSnippet: "Spawn a minion for isolated task delegation",
    promptGuidelines: [
      "Use spawn for foreground task delegation. The tool blocks until the minion completes — use this when you need the result immediately.",
      "For background execution, use spawn_bg instead.",
      "Omit the agent parameter to spawn an ephemeral minion with default capabilities.",
      "Use list_agents to discover available named agents before spawning by name.",
      "When a spawn result contains [USER ACTION] and mentions background, the user used /minions bg to move the minion. This is intentional, not an error. Acknowledge briefly and continue.",
      "When a spawn result says [HALTED], the user intentionally stopped the minion. Do NOT retry, re-spawn, or ask about it. Acknowledge and move on.",
    ],
    parameters: SpawnToolParams,
    execute: makeSpawnExecute(tree, handles, detachHandles, queue, pi, sessions),
    renderCall,
    renderResult,
  });

  pi.registerTool({
    name: "spawn_bg",
    label: "Spawn Minion (Background)",
    description:
      "Spawn a minion in the background. The tool returns immediately while the minion runs independently. " +
      "Results are automatically delivered when the minion completes. " +
      "Use this only when the user explicitly requests background execution.",
    promptSnippet: "Spawn a background minion for fire-and-forget delegation",
    promptGuidelines: [
      "Only use spawn_bg when the user explicitly asks for background execution.",
      "For normal task delegation, use spawn (foreground) instead.",
    ],
    parameters: SpawnBgToolParams,
    execute: makeSpawnBgExecute(tree, handles, queue, pi, sessions),
  });

  pi.registerTool({
    name: "list_agents",
    label: "List Agents",
    description: "List available agents that can be spawned as minions.",
    promptSnippet: "List available agents for spawning",
    parameters: ListAgentsParams,
    execute: makeListAgentsExecute(),
  });

  pi.registerTool({
    name: "halt",
    label: "Halt Minion",
    description:
      "Abort a running minion by ID. Use id='all' to halt all running minions.",
    parameters: HaltToolParams,
    execute: makeHaltExecute(tree, handles),
  });

  pi.registerTool({
    name: "list_minions",
    label: "List Minions",
    description: "List all running and pending minions with their status and current activity.",
    promptSnippet: "Check on running minions",
    parameters: ListMinionsParams,
    execute: makeListMinionsExecute(tree, queue, detachHandles),
  });

  pi.registerTool({
    name: "show_minion",
    label: "Show Minion",
    description: "Show detailed status, activity, and output of a minion by ID or name.",
    parameters: ShowMinionParams,
    execute: makeShowMinionExecute(tree, queue),
  });

  pi.registerTool({
    name: "steer_minion",
    label: "Steer Minion",
    description: "Send a steering message to a running minion. The message is injected into the minion's context before its next LLM call.",
    promptSnippet: "Redirect a running minion with new instructions",
    parameters: SteerMinionParams,
    execute: makeSteerMinionExecute(tree, sessions),
  });

  pi.registerCommand("spawn", {
    description: "Spawn a minion: /spawn <task> [--model <model>] [--bg]",
    handler: makeSpawnHandler(pi),
  });

  pi.registerCommand("minions", {
    description: "Manage minions: /minions [list|show|bg|steer] [id|name] [message]",
    handler: makeMinionsHandler(tree, pi, detachHandles),
  });

  pi.registerCommand("halt", {
    description: "Halt minion(s): /halt <id | name | all>",
    handler: makeHaltHandler(tree, handles),
  });

  // Track model changes so we always know what model is active
  pi.on("session_start", (_event, ctx) => {
    logger.debug("session", "start", {
      model: ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "none",
      cwd: ctx.cwd,
    });
  });

  pi.on("model_select", (event, _ctx) => {
    logger.debug("session", "model_select", {
      model: `${event.model.provider}/${event.model.id}`,
      name: event.model.name,
      source: event.source,
      previous: event.previousModel
        ? `${event.previousModel.provider}/${event.previousModel.id}`
        : "none",
    });
  });

  // Background minion status in footer
  const BG_STATUS_KEY = "minions-bg";
  let cachedUi: ExtensionContext["ui"] | null = null;
  let lastBgCount = -1;

  function refreshBgStatus(): void {
    if (!cachedUi) {
      logger.debug("bg-status", "skip-no-ui");
      return;
    }
    const allRunning = tree.getRunning();
    const bgRunning = allRunning.filter((n) => !detachHandles.has(n.id));
    const count = bgRunning.length;
    if (count === lastBgCount) return;
    logger.debug("bg-status", "update", {
      from: lastBgCount, to: count,
      allRunning: allRunning.map((n) => `${n.name}(${n.id})`),
      detachHandles: [...detachHandles.keys()],
    });
    lastBgCount = count;
    const { theme } = cachedUi;
    cachedUi.setStatus(BG_STATUS_KEY, count === 0
      ? undefined
      : theme.fg("muted", `background minions: ${count} — /minions to manage`));
  }

  // Event-driven: tree changes + tool boundaries trigger status refresh.
  // tree.onChange catches: add (bg spawn), updateStatus (complete/fail/abort)
  // tool_execution_end catches: detach (detachHandles changes, tree unchanged)
  tree.onChange(refreshBgStatus);
  pi.on("tool_execution_end", (event) => {
    logger.debug("bg-status", "tool_execution_end", { tool: event.toolName });
    refreshBgStatus();
  });

  pi.on("session_start", (_event, ctx) => {
    cachedUi = ctx.ui;
  });
}
