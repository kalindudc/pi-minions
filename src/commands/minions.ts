import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import type { AgentTree } from "../tree.js";
import type { DetachHandle } from "../tools/spawn.js";
import { logger } from "../logger.js";

type ParsedArgs =
  | { action: "list" }
  | { action: "show" | "bg"; target: string }
  | { action: "steer"; target: string; message: string }
  | { error: string };

export function parseMinionArgs(args: string): ParsedArgs {
  const tokens = args.trim().split(/\s+/).filter(Boolean);

  if (tokens.length === 0) return { action: "list" };

  const action = tokens[0]!;

  if (action === "list") return { action: "list" };

  if (action === "show" || action === "bg") {
    const target = tokens.slice(1).join(" ").trim();
    if (!target) {
      return { error: `Usage: /minions ${action} <id | name>` };
    }
    return { action, target };
  }

  if (action === "steer") {
    if (tokens.length < 3) {
      return { error: "Usage: /minions steer <id | name> <message>" };
    }
    const target = tokens[1]!;
    const message = tokens.slice(2).join(" ");
    return { action: "steer", target, message };
  }

  return { error: `Unknown subcommand: ${action}. Use list, show, bg, or steer.` };
}

/**
 * Send a directive to the parent. When idle, sends as a normal user message
 * (visible in TUI). When busy, queues as a follow-up and notifies the user.
 */
function sendDirective(pi: ExtensionAPI, ctx: ExtensionCommandContext, directive: string, label: string): void {
  const idle = ctx.isIdle();
  const pending = ctx.hasPendingMessages();
  logger.debug("minions:cmd", "sendDirective", { label, idle, pending });

  if (idle) {
    logger.debug("minions:cmd", "sendUserMessage (idle)", { directive: directive.slice(0, 80) });
    pi.sendUserMessage(directive);
  } else {
    logger.debug("minions:cmd", "sendUserMessage (busy, followUp)", { directive: directive.slice(0, 80) });
    pi.sendUserMessage(directive, { deliverAs: "followUp" });
    ctx.ui.notify(`Queued: ${label} (will run after current task)`, "info");
  }
}

export function makeMinionsHandler(
  tree: AgentTree,
  pi: ExtensionAPI,
  detachHandles: Map<string, DetachHandle>,
) {
  return async function handler(args: string, ctx: ExtensionCommandContext): Promise<void> {
    const parsed = parseMinionArgs(args);

    if ("error" in parsed) {
      ctx.ui.notify(parsed.error, "error");
      return;
    }

    // list, show, steer → delegate to parent so the LLM calls the tool and
    // sees the result in context. Uses sendDirective to queue visibly when busy.
    if (parsed.action === "list") {
      sendDirective(pi, ctx, "Use the list_minions tool to show all running and pending minions.", "/minions list");
      return;
    }

    if (parsed.action === "show") {
      sendDirective(pi, ctx, `Use the show_minion tool to inspect minion "${parsed.target}".`, `/minions show ${parsed.target}`);
      return;
    }

    if (parsed.action === "steer") {
      sendDirective(pi, ctx, `Use the steer_minion tool to steer minion "${parsed.target}" with this message: ${parsed.message}`, `/minions steer ${parsed.target}`);
      return;
    }

    // bg → must act directly because the parent is blocked by the foreground
    // spawn tool. The spawn tool's detach path returns a visible result.
    if (parsed.action === "bg") {
      logger.debug("minions:cmd", "bg", { target: parsed.target });
      const node = tree.resolve(parsed.target);
      if (!node) {
        logger.debug("minions:cmd", "bg-not-found", { target: parsed.target });
        ctx.ui.notify(`Minion not found: ${parsed.target}`, "error");
        return;
      }
      if (node.status !== "running") {
        ctx.ui.notify(`Minion ${node.name} (${node.id}) is not running (status: ${node.status}).`, "info");
        return;
      }
      const handle = detachHandles.get(node.id);
      if (!handle) {
        ctx.ui.notify(`Minion ${node.name} (${node.id}) is already running in background.`, "info");
        return;
      }
      logger.debug("minions:cmd", "bg-detaching", { id: node.id, name: node.name });
      handle.resolve();
      logger.debug("minions:cmd", "bg-detached", { id: node.id, name: node.name });
      ctx.ui.notify(`Sent ${node.name} (${node.id}) to background.`, "info");
      return;
    }
  };
}
