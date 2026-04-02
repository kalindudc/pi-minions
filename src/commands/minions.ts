import type { ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import type { AgentTree } from "../tree.js";
import type { ResultQueue } from "../queue.js";
import { buildListMinionsText, buildShowMinionText, validateSteerTarget, executeSteering } from "../tools/minions.js";
import { detachMinion } from "../tools/spawn.js";
import { logger } from "../logger.js";
import type { SubsessionManager } from "../subsessions/manager.js";

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

export function createMinionsHandler(
  tree: AgentTree,
  queue: ResultQueue,
  subsessionManager: SubsessionManager,
) {
  return async function handler(args: string, ctx: ExtensionCommandContext): Promise<void> {
    const parsed = parseMinionArgs(args);

    if ("error" in parsed) {
      ctx.ui.notify(parsed.error, "error");
      return;
    }

    // list, show, steer → always act immediately (instantaneous response)
    if (parsed.action === "list") {
      const text = buildListMinionsText(tree, queue, subsessionManager);
      ctx.ui.notify(text, "info");
      return;
    }

    if (parsed.action === "show") {
      const text = buildShowMinionText(tree, queue, parsed.target);
      if (text === null) {
        ctx.ui.notify(`Minion not found: ${parsed.target}`, "error");
      } else {
        ctx.ui.notify(text, "info");
      }
      return;
    }

    if (parsed.action === "steer") {
      const validation = validateSteerTarget(tree, subsessionManager, parsed.target);
      if (validation.success === false) {
        ctx.ui.notify(validation.error, validation.errorType);
        return;
      }

      const successMessage = await executeSteering(validation.node, validation.steer, parsed.message);
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
        ctx.ui.notify(`Minion ${node.name} (${node.id}) is not running (status: ${node.status}).`, "info");
        return;
      }
      
      // Check if session exists (foreground) or just metadata (background)
      const session = subsessionManager.getSession(node.id);
      if (!session) {
        ctx.ui.notify(`Minion ${node.name} (${node.id}) is already running in background.`, "info");
        return;
      }

      logger.debug("minions:cmd", "bg-detaching", { id: node.id, name: node.name });
      detachMinion(node.id);
      logger.debug("minions:cmd", "bg-detached", { id: node.id, name: node.name });
      ctx.ui.notify(`Sent ${node.name} (${node.id}) to background.`, "info");
      return;
    }
  };
}
