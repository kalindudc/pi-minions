import type { ExtensionAPI, ExtensionContext, BeforeAgentStartEvent } from "@mariozechner/pi-coding-agent";
import type { Model } from "@mariozechner/pi-ai";
import { AgentTree } from "./tree.js";
import { ResultQueue } from "./queue.js";
import { SpawnToolParams, SpawnBgToolParams, spawn, spawnBg } from "./tools/spawn.js";
import { HaltToolParams, halt } from "./tools/halt.js";
import { ListAgentsParams, listAgents } from "./tools/list-agents.js";
import {
  ListMinionsParams, listMinions,
  SteerMinionParams, steerMinion,
  ShowMinionParams,
  showMinion,
} from "./tools/minions.js";
import { createSpawnHandler } from "./commands/spawn.js";
import { createHaltHandler } from "./commands/halt.js";
import { createMinionsHandler } from "./commands/minions.js";
import { renderCall, renderResult } from "./render.js";
import { buildFooterFactory } from "./footer.js";
import { createStatusTracker } from "./status.js";
import { logger, LOG_FILE } from "./logger.js";
import { SubsessionManager } from "./subsessions/manager.js";
import { EventBus } from "./subsessions/event-bus.js";
import { getTempSessionPath } from "./subsessions/paths.js";
import { minionSpawnRenderer } from "./renderers/minion-spawn.js";
import { AgentMessage } from "@mariozechner/pi-agent-core";

function createDelegationHint(toolCallCount: number): string {
  return "\n\n[DELEGATION REMINDER]: You have made: " + toolCallCount +
        " tool calls. The pi-minions extension is active and provides tools for parallel execution and work delegation." +
        "\nConsider delegating independent subtasks to minions for faster, isolated processing." +
        "\nFollow any delegation skills or principles you have been provided by the system or the user.";
}

function buildPromptFromContext(messages: AgentMessage[]): string {
  return messages
    .filter(msg => msg.role === "user")
    .map(msg => typeof msg.content === "string" ? msg.content : "")
    .join("\n");
}

export default function (pi: ExtensionAPI): void {
  logger.debug("extension", "loaded", { logFile: LOG_FILE });

  // Core state
  const tree = new AgentTree();
  const queue = new ResultQueue();
  // SubsessionManager is initialized in session_start event
  let subsessionManager: SubsessionManager | undefined;

  // Minion status tracking (background and foreground)
  // Status tracker is initialized after subsessionManager in session_start
  let statusTracker: ReturnType<typeof createStatusTracker> | undefined;
  let cachedUi: ExtensionContext["ui"] | null = null;
  let cachedCtx: ExtensionContext | null = null;
  let cachedModel: Model<any> | undefined;

  // EventBus for minion progress streaming
  const eventBus = new EventBus();

  // Delegation conscience: Track tool calls and inject delegation reminder
  const TOOL_CALL_THRESHOLD = 8;
  const HINT_INTERVAL = 60000 * 5;

  let toolCallCount = 0;
  let lastPromptText = "";
  let lastHintTime = 0;

  let usedMinionsThisSession = false;

  pi.registerTool({
    name: "spawn",
    label: "Spawn Minion",
    description:
      "Delegate a task to a named agent or an ephemeral minion with isolated context. " +
      "If no agent name is provided, spawns an ephemeral minion with default capabilities. " +
      "Agents are discovered from ~/.pi/agent/agents/ and .pi/agents/. " +
      "The agent runs as a file-based session with parent tracking.",
    promptSnippet: "Spawn a minion for isolated task delegation",
    promptGuidelines: [
      "Use spawn for \"foreground\" task delegation. The tool blocks until the minion completes and returns its result.",
      "To spawn multiple minions in parallel, emit multiple spawn calls in a single response. All results are returned together when all minions complete.",
      "For fire-and-forget delegation where you do not need the result immediately, use spawn_bg instead.",
      "Omit the agent parameter to spawn an ephemeral minion with default capabilities.",
      "Use list_agents to discover available named agents before spawning by name.",
      "When a spawn result contains [USER ACTION] and mentions background, the user used /minions bg to move the minion. This is intentional, not an error. Acknowledge briefly and continue.",
      "When a spawn result says [HALTED], the user intentionally stopped the minion. Do NOT retry, re-spawn, or ask about it. Acknowledge and move on.",
    ],
    parameters: SpawnToolParams,
    execute: (...args) => {
      if (!subsessionManager) throw new Error("SubsessionManager not initialized");
      usedMinionsThisSession = true;
      return spawn(tree, queue, pi, subsessionManager)(...args);
    },
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
      "Use spawn_bg for fire-and-forget tasks where you do not need the result before continuing.",
      "Only use spawn_bg when the user explicitly asks for \"background\" execution.",
      "For results you need before proceeding, use spawn (foreground) instead.",
    ],
    parameters: SpawnBgToolParams,
    execute: (...args) => {
      if (!subsessionManager) throw new Error("SubsessionManager not initialized");
      usedMinionsThisSession = true;
      return spawnBg(tree, queue, pi, subsessionManager)(...args);
    },
  });

  pi.registerTool({
    name: "list_agents",
    label: "List Agents",
    description: "List available agents that can be spawned as minions.",
    promptSnippet: "List available agents for spawning",
    parameters: ListAgentsParams,
    execute: listAgents(),
  });

  pi.registerTool({
    name: "halt",
    label: "Halt Minion",
    description:
      "Abort a running minion by ID. Use id='all' to halt all running minions.",
    parameters: HaltToolParams,
    execute: (...args) => {
      if (!subsessionManager) throw new Error("SubsessionManager not initialized");
      return halt(tree, subsessionManager)(...args);
    },
  });

  pi.registerTool({
    name: "list_minions",
    label: "List Minions",
    description: "List all running and pending minions with their status and current activity.",
    promptSnippet: "Check on running minions",
    parameters: ListMinionsParams,
    execute: (...args) => {
      if (!subsessionManager) throw new Error("SubsessionManager not initialized");
      return listMinions(tree, queue, subsessionManager)(...args);
    },
  });

  pi.registerTool({
    name: "show_minion",
    label: "Show Minion",
    description: "Show detailed status, activity, and output of a minion by ID or name.",
    parameters: ShowMinionParams,
    execute: showMinion(tree, queue),
  });

  // Register custom message renderer for minion spawn status
  pi.registerMessageRenderer("minion-spawn", minionSpawnRenderer);

  pi.registerTool({
    name: "steer_minion",
    label: "Steer Minion",
    description: "Send a steering message to a running minion. The message is injected into the minion's context before its next LLM call.",
    promptSnippet: "Redirect a running minion with new instructions",
    parameters: SteerMinionParams,
    execute: (...args) => {
      if (!subsessionManager) throw new Error("SubsessionManager not initialized");
      return steerMinion(tree, subsessionManager)(...args);
    },
  });

  pi.registerCommand("spawn", {
    description: "Spawn a minion: /spawn <task> [--model <model>] [--bg]",
    handler: createSpawnHandler(pi),
  });

  pi.registerCommand("minions", {
    description: "Manage minions: /minions [list|bg|steer] [id|name] [message]",
    handler: (args, ctx) => {
      if (!subsessionManager) throw new Error("SubsessionManager not initialized");
      return createMinionsHandler(tree, queue, subsessionManager, eventBus)(args, ctx);
    },
  });

  pi.registerCommand("halt", {
    description: "Halt minion(s): /halt <id | name | all>",
    handler: (args, ctx) => {
      if (!subsessionManager) throw new Error("SubsessionManager not initialized");
      return createHaltHandler(tree, subsessionManager)(args, ctx);
    },
  });


  tree.onChange(() => statusTracker?.refresh());
  pi.on("tool_execution_end", (event) => {
    logger.debug("status", "tool_execution_end", { tool: event.toolName });
    statusTracker?.refresh();
  });

  pi.on("turn_start", async () => {
    // none
  });

  pi.on("tool_call", async () => {
    toolCallCount++;
  });

  pi.on("context", async (event, ctx) => {
    const prompt = buildPromptFromContext(event.messages);
    const isComplexTask = toolCallCount >= TOOL_CALL_THRESHOLD ||
      prompt.length > 200 ||
      /\b(investigate|audit|review|refactor|analyze|implement)\b/i.test(prompt);

    lastPromptText = prompt;

    // only send hint if we haven't used minions yet in this session, it's a complex task
    // and we haven't sent a hint recently (avoid spamming hints on every turn for complex tasks)
    const currentTime = Date.now();
    const shouldSendHint = !usedMinionsThisSession && isComplexTask && (currentTime - lastHintTime > HINT_INTERVAL);

    const messages = [...event.messages]

    // Only inject hint for complex tasks and when prompt changes (avoid spam)
    if (shouldSendHint) {
      logger.debug("delegation", "injecting_hint", { toolCallCount, promptLength: prompt.length });

      messages.push({
        role: "user",
        content: createDelegationHint(toolCallCount),
        timestamp: currentTime,
      });

      toolCallCount = 0;
      lastHintTime = currentTime;
    }

    return {
      messages: messages,
    };
  });

  pi.on("session_start", (_event, ctx) => {
    cachedCtx = ctx;
    cachedModel = ctx.model;
    cachedUi = ctx.ui;
    usedMinionsThisSession = false;

    // Create subsession manager for file-based minion sessions (always use file-based)
    const parentSessionPath = ctx.sessionManager?.getSessionFile() ?? getTempSessionPath(ctx.cwd);
    subsessionManager = new SubsessionManager(ctx.cwd, parentSessionPath, eventBus);
    logger.debug("session", "subsession-manager-created", {
      cwd: ctx.cwd,
      parentSession: parentSessionPath,
      isTemp: !ctx.sessionManager?.getSessionFile(),
    });

    // Initialize status tracker now that we have subsessionManager
    statusTracker = createStatusTracker(tree, subsessionManager);
    statusTracker.setUi(cachedUi);

    // Clean up legacy status keys from previous versions
    cachedUi.setStatus("minions-bg", undefined);
    cachedUi.setStatus("minions-fg", undefined);

    cachedUi.setFooter(buildFooterFactory({
      getCtx: () => cachedCtx,
      getModel: () => cachedModel,
      getThinkingLevel: () => pi.getThinkingLevel(),
      tree,
    }));
  });
}

