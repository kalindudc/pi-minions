import { readFileSync } from "node:fs";

// Helper function to reverse changelog sections so newest appears first
function reverseChangelog(content: string): string {
  const lines = content.split("\n");
  const sections: string[][] = [];
  let currentSection: string[] = [];

  for (const line of lines) {
    if (line.startsWith("## [")) {
      if (currentSection.length > 0) {
        sections.push(currentSection);
      }
      currentSection = [line];
    } else {
      currentSection.push(line);
    }
  }

  if (currentSection.length > 0) {
    sections.push(currentSection);
  }

  // Reverse sections and flatten
  const reversed = sections.reverse().flat();
  return reversed.join("\n");
}

import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { discoverAgents } from "../agents.js";
import { getConfig } from "../config.js";
import { logger } from "../logger.js";
import type { ResultQueue } from "../queue.js";
import type { EventBus } from "../subsessions/event-bus.js";
import type { SubsessionManager } from "../subsessions/manager.js";
import { showMinionObservability } from "../subsessions/observability.js";
import { executeSteering, validateSteerTarget } from "../tools/minions.js";
import { detachMinion } from "../tools/spawn.js";
import type { AgentTree } from "../tree.js";
import { CHANGELOG_PATH, VERSION } from "../version.js";

type ParsedArgs =
  | { action: "list" }
  | { action: "version" }
  | { action: "changelog" }
  | { action: "help" }
  | { action: "show-running" }
  | { action: "show"; target: string }
  | { action: "bg"; target: string }
  | { action: "fg"; target: string }
  | { action: "steer"; target: string; message: string }
  | { error: string };

export function parseMinionArgs(args: string): ParsedArgs {
  const tokens = args.trim().split(/\s+/).filter(Boolean);

  if (tokens.length === 0) return { action: "show-running" };

  const action = tokens[0];

  if (action === "list") return { action: "list" };

  if (action === "show" || action === "s") {
    const target = tokens.slice(1).join(" ").trim();
    if (!target) {
      return { error: `Usage: /minions show <id | name>` };
    }
    return { action: "show", target };
  }

  if (action === "bg") {
    const target = tokens.slice(1).join(" ").trim();
    if (!target) {
      return { error: `Usage: /minions bg <id | name>` };
    }
    return { action, target };
  }

  if (action === "fg") {
    const target = tokens.slice(1).join(" ").trim();
    if (!target) {
      return { error: `Usage: /minions fg <id | name>` };
    }
    return { action: "fg", target };
  }

  if (action === "steer") {
    if (tokens.length < 3) {
      return { error: "Usage: /minions steer <id | name> <message>" };
    }
    const target = tokens[1] ?? "";
    const message = tokens.slice(2).join(" ");
    return { action: "steer", target, message };
  }

  if (action === "version") return { action: "version" };
  if (action === "changelog") return { action: "changelog" };
  if (action === "help" || action === "h") return { action: "help" };

  return {
    error: `Unknown subcommand: ${action}. Use [help] to see the list of available commands.`,
  };
}

// Get alphabetically sorted list of running minions
function getSortedMinionIds(tree: AgentTree): string[] {
  const running = tree.getRunning();
  return running
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((m) => m.id);
}

// Show minion observability with cycling support
async function showMinionWithCycling(
  ctx: ExtensionCommandContext,
  tree: AgentTree,
  eventBus: EventBus,
  startMinionId: string,
): Promise<void> {
  let currentId: string | null = startMinionId;

  const cycleToMinion = (currentId: string, direction: "next" | "prev"): string | null => {
    const sortedIds = getSortedMinionIds(tree);
    if (sortedIds.length === 0) return null;

    const currentIndex = sortedIds.indexOf(currentId);
    if (currentIndex === -1) {
      return sortedIds[0] ?? null;
    }

    if (direction === "next") {
      return sortedIds[(currentIndex + 1) % sortedIds.length] ?? null;
    } else {
      return sortedIds[(currentIndex - 1 + sortedIds.length) % sortedIds.length] ?? null;
    }
  };

  while (currentId) {
    logger.debug("minions:cmd", "opening-observability", { currentId });

    let nextId: string | null = null;
    const result = await showMinionObservability(ctx, tree, eventBus, currentId, (direction) => {
      nextId = currentId ? cycleToMinion(currentId, direction) : null;
    });

    if (result.action === "close") {
      logger.debug("minions:cmd", "observability-closed");
      return;
    }

    if (result.action === "back") {
      return;
    }

    // result.action === "cycle" - user pressed tab/shift+tab
    if (nextId) {
      currentId = nextId;
    } else {
      return;
    }
  }
}

export function showListMinions(ctx: ExtensionCommandContext) {
  const { agents } = discoverAgents(ctx.cwd, "both");
  const config = getConfig(ctx);
  const lines = ["Available minion types:"];
  if (config.allowEphemeral) {
    lines.push("  minion (built-in): General-purpose ephemeral minion with default capabilities");
  }

  for (const a of agents) {
    const model = a.model ? ` [model: ${a.model}]` : "";
    lines.push(`  ${a.name} (${a.source}): ${a.description}${model}`);
  }

  ctx.ui.notify(lines.join("\n"), "info");
  logger.debug("minions:cmd", "list-complete", { agentCount: agents.length });
  return;
}

export function createMinionsHandler(
  tree: AgentTree,
  _queue: ResultQueue,
  subsessionManager: SubsessionManager,
  eventBus: EventBus,
  pi: ExtensionAPI,
) {
  return async function handler(args: string, ctx: ExtensionCommandContext): Promise<void> {
    logger.debug("minions:cmd", "handler-called", { args: args.trim() || "(empty)" });

    const parsed = parseMinionArgs(args);
    logger.debug("minions:cmd", "parsed-args", {
      action: "action" in parsed ? parsed.action : "error",
    });

    if ("error" in parsed) {
      logger.debug("minions:cmd", "parse-error", { error: parsed.error });
      ctx.ui.notify(parsed.error, "error");
      return;
    }

    // list → show available agent types (alias of list_agents)
    if (parsed.action === "list") {
      logger.debug("minions:cmd", "list");

      return showListMinions(ctx);
    }

    // show-running → open minion view with cycling (default behavior)
    if (parsed.action === "show-running") {
      logger.debug("minions:cmd", "show-running");
      const sortedIds = getSortedMinionIds(tree);

      if (sortedIds.length === 0) {
        ctx.ui.notify("No active minions. Spawn one with /spawn or the spawn tool.", "info");
        return;
      }

      await showMinionWithCycling(ctx, tree, eventBus, sortedIds[0] ?? "");
      return;
    }

    if (parsed.action === "version") {
      logger.debug("minions:cmd", "version", { version: VERSION });
      ctx.ui.notify(`pi-minions v${VERSION}`, "info");
      return;
    }

    if (parsed.action === "changelog") {
      logger.debug("minions:cmd", "changelog", { changelogPath: CHANGELOG_PATH });

      try {
        const content = readFileSync(CHANGELOG_PATH, "utf-8");
        logger.debug("minions:cmd", "changelog-read", { contentLength: content.length });
        const reversedContent = reverseChangelog(content);
        logger.debug("minions:cmd", "changelog-reversed");

        pi.sendMessage({
          customType: "minion-changelog",
          content: "",
          display: true,
          details: { content: reversedContent },
        });

        logger.debug("minions:cmd", "changelog-sent");
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.debug("minions:cmd", "changelog-error", { error: errorMessage });
        ctx.ui.notify(`Failed to read changelog: ${errorMessage}`, "error");
      }
      return;
    }

    if (parsed.action === "help") {
      logger.debug("minions:cmd", "help");

      const lines = ["Available /minions subcommands:"];
      lines.push("  bg <id|name>       - Send a foreground minion to background");
      lines.push("  changelog          - Show the extension changelog");
      lines.push(
        "  fg <id|name>       - Bring a background minion to foreground (blocks with progress)",
      );
      lines.push("  h, help            - Show this help message");
      lines.push("  list               - List available agent types");
      lines.push("  s, show <id|name>  - Show detailed status of a specific minion");
      lines.push("  steer <id> <msg>   - Send a steering message to a running minion");
      lines.push("  version            - Show the extension version");

      ctx.ui.notify(lines.join("\n"), "info");
      logger.debug("minions:cmd", "help-complete");
      return;
    }

    // show → open specific minion view with cycling
    if (parsed.action === "show") {
      const node = tree.resolve(parsed.target);
      if (!node) {
        ctx.ui.notify(`Minion not found: ${parsed.target}`, "error");
        return;
      }

      await showMinionWithCycling(ctx, tree, eventBus, node.id);
      return;
    }

    if (parsed.action === "steer") {
      const validation = validateSteerTarget(tree, subsessionManager, parsed.target);
      if (validation.success === false) {
        ctx.ui.notify(validation.error, validation.errorType);
        return;
      }

      const successMessage = await executeSteering(
        validation.node,
        validation.steer,
        parsed.message,
      );
      ctx.ui.notify(successMessage, "info");
      return;
    }

    // bg → signals the foreground spawn to detach
    if (parsed.action === "bg") {
      logger.debug("minions:cmd", "bg", { target: parsed.target });
      const node = tree.resolve(parsed.target);
      if (!node) {
        logger.debug("minions:cmd", "bg-not-found", { target: parsed.target });
        ctx.ui.notify(`Minion not found: ${parsed.target}`, "error");
        return;
      }
      if (node.status !== "running") {
        ctx.ui.notify(
          `Minion ${node.name} (${node.id}) is not running (status: ${node.status}).`,
          "info",
        );
        return;
      }

      // Check if session exists (foreground) or just metadata (background)
      const session = subsessionManager.getSession(node.id);
      if (!session) {
        ctx.ui.notify(`Minion ${node.name} (${node.id}) is already running in background.`, "info");
        return;
      }

      logger.debug("minions:cmd", "bg-detaching", {
        id: node.id,
        name: node.name,
      });
      detachMinion(node.id);
      // Mark as detached for [fg]/[bg] badge (deviation 10)
      tree.markDetached(node.id);
      logger.debug("minions:cmd", "bg-detached", {
        id: node.id,
        name: node.name,
      });
      ctx.ui.notify(`Sent ${node.name} (${node.id}) to background.`, "info");
      return;
    }

    // fg → brings a background minion to foreground
    if (parsed.action === "fg") {
      logger.debug("minions:cmd", "fg", { target: parsed.target });
      const node = tree.resolve(parsed.target);
      if (!node) {
        logger.debug("minions:cmd", "fg-not-found", { target: parsed.target });
        ctx.ui.notify(`Minion not found: ${parsed.target}`, "error");
        return;
      }
      if (node.status !== "running") {
        ctx.ui.notify(
          `Minion ${node.name} (${node.id}) is not running (status: ${node.status}).`,
          "info",
        );
        return;
      }
      if (!node.detached) {
        ctx.ui.notify(`Minion ${node.name} (${node.id}) is already in foreground.`, "info");
        return;
      }

      logger.debug("minions:cmd", "fg-requesting", {
        id: node.id,
        name: node.name,
      });

      // Send directive to parent to use spawn tool with ids parameter
      // This is the same pattern used by /spawn command
      pi.sendUserMessage(
        `Use the spawn tool with ids=["${node.name}"] to bring this background minion to foreground.`,
        { deliverAs: "steer" },
      );

      logger.debug("minions:cmd", "fg-request-sent", { id: node.id, name: node.name });
      return;
    }
  };
}
