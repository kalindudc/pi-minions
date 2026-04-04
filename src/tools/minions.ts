import type { AgentToolResult, ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { Static } from "@sinclair/typebox";
import { Type } from "@sinclair/typebox";
import { discoverAgents } from "../agents.js";
import type { ResultQueue } from "../queue.js";
import { formatDuration, formatUsage } from "../render.js";
import type { SubsessionManager } from "../subsessions/manager.js";
import { getMinionHistory } from "../subsessions/observability.js";
import type { AgentTree } from "../tree.js";
import type { AgentNode } from "../types.js";
import type { ListAgentsParams } from "./list-agents.js";

// Shared validation helpers

/**
 * Result of validating a minion for steering operations
 */
export type SteerValidationResult =
  | { success: false; error: string; errorType: "error" | "info" }
  | { success: true; node: AgentNode; steer: (text: string) => Promise<void> };

/**
 * Validates that a target can be steered and returns the node/steer function or error details
 */
export function validateSteerTarget(
  tree: AgentTree,
  subsessionManager: SubsessionManager,
  target: string,
): SteerValidationResult {
  const node = tree.resolve(target);
  if (!node) {
    return {
      success: false,
      error: `Minion not found: ${target}`,
      errorType: "error",
    };
  }

  if (node.status !== "running") {
    return {
      success: false,
      error: `Minion ${node.name} (${node.id}) is not running (status: ${node.status}).`,
      errorType: "info",
    };
  }

  const session = subsessionManager.getSession(node.id);
  if (!session) {
    return {
      success: false,
      error: `No active session for ${node.name} (${node.id}).`,
      errorType: "error",
    };
  }

  return { success: true, node, steer: (text) => session.steer(text) };
}

/**
 * Executes steering operation and returns success message
 */
export async function executeSteering(
  node: AgentNode,
  steer: (text: string) => Promise<void>,
  message: string,
): Promise<string> {
  const wrappedMessage =
    `[USER STEER] The user has provided an additional directive while you are working.\n` +
    `DO NOT abandon or restart your current task. Continue where you left off.\n` +
    `Treat this steer as a supplementary task to handle alongside your original assignment.\n` +
    `When you deliver your final output, include results from both your original task AND this steer directive.\n` +
    `Explicitly note that you received a user steer and include the steer task verbatim.\n\n` +
    `User's steer message: ${message}`;
  await steer(wrappedMessage);
  return `Steered ${node.name} (${node.id}): ${message}`;
}

// list_minions

export type ListMinionsParams = Static<typeof ListAgentsParams>;

export function listMinions() {
  return async function execute(
    _toolCallId: string,
    _params: ListMinionsParams,
    _signal: AbortSignal | undefined,
    _onUpdate: unknown,
    ctx: ExtensionContext,
  ): Promise<AgentToolResult<unknown>> {
    const { agents } = discoverAgents(ctx.cwd, "both");

    const lines: string[] = [];

    // Built-in ephemeral minion (always available)
    lines.push("  minion (built-in): General-purpose ephemeral minion with default capabilities");

    for (const a of agents) {
      const model = a.model ? ` [model: ${a.model}]` : "";
      lines.push(`  ${a.name} (${a.source}): ${a.description}${model}`);
    }

    return {
      content: [{ type: "text", text: `Available agents:\n${lines.join("\n")}` }],
      details: undefined,
    };
  };
}

// steer_minion

export const SteerMinionParams = Type.Object({
  target: Type.String({ description: "Minion ID or name to steer" }),
  message: Type.String({
    description: "Message to inject into the minion's context before its next LLM call",
  }),
});
export type SteerMinionParams = Static<typeof SteerMinionParams>;

export function steerMinion(tree: AgentTree, subsessionManager: SubsessionManager) {
  return async function execute(
    _toolCallId: string,
    params: SteerMinionParams,
    _signal: AbortSignal | undefined,
    _onUpdate: unknown,
    _ctx: ExtensionContext,
  ): Promise<AgentToolResult<unknown>> {
    const validation = validateSteerTarget(tree, subsessionManager, params.target);
    if (!validation.success) {
      throw new Error(validation.error);
    }

    const successMessage = await executeSteering(validation.node, validation.steer, params.message);
    return {
      content: [{ type: "text", text: successMessage }],
      details: undefined,
    };
  };
}

// show_minion

export function buildShowMinionText(
  tree: AgentTree,
  queue: ResultQueue,
  target: string,
): string | null {
  const node = tree.resolve(target);
  const result = queue.get(target);

  if (!node && !result) {
    return null;
  }

  const lines: string[] = [];
  if (node) {
    // Header with mode badge and agent name
    const mode = node.detached ? "[bg]" : "[fg]";
    const displayName =
      node.agentName && node.agentName !== "ephemeral"
        ? `${node.agentName} ${node.name}`
        : node.name;
    lines.push(`${displayName} (${node.id}) ${mode}`);
    lines.push(`  Status: ${node.status}`);
    lines.push(`  Task: ${node.task}`);

    if (node.status === "running") {
      lines.push(`  Running for: ${formatDuration(Date.now() - node.startTime)}`);
      if (node.lastActivity) lines.push(`  Activity: ${node.lastActivity}`);
    }

    if (node.endTime) lines.push(`  Duration: ${formatDuration(node.endTime - node.startTime)}`);
    const usageText = formatUsage(node.usage);
    lines.push(`  Usage: ${usageText || "N/A"}`);
    if (node.error) lines.push(`  Error: ${node.error}`);

    // Include recent activity history
    const history = getMinionHistory(node.id);
    if (history.length > 0) {
      lines.push(`  Recent activity:`);
      for (const msg of history) {
        lines.push(`    ${msg}`);
      }
    }

    // Suggest interactive view for live updates
    if (node.status === "running") {
      lines.push(`\n  Tip: Use '/minions show ${node.name}' for live activity stream`);
    }
  }
  if (result) {
    if (!node) lines.push(`${result.name} (${result.id})`);
    lines.push(`  Exit code: ${result.exitCode}`);
    if (result.output) {
      const preview = result.output.split("\n").slice(0, 10).join("\n");
      lines.push(`  Output:\n${preview}`);
    }
  }
  return lines.join("\n");
}

export const ShowMinionParams = Type.Object({
  target: Type.String({ description: "Minion ID or name to inspect" }),
});
export type ShowMinionParams = Static<typeof ShowMinionParams>;

export function showMinion(tree: AgentTree, queue: ResultQueue) {
  return async function execute(
    _toolCallId: string,
    params: ShowMinionParams,
    _signal: AbortSignal | undefined,
    _onUpdate: unknown,
    _ctx: ExtensionContext,
  ): Promise<AgentToolResult<unknown>> {
    const text = buildShowMinionText(tree, queue, params.target);
    if (text === null) {
      throw new Error(`Minion not found: ${params.target}`);
    }
    return { content: [{ type: "text", text }], details: undefined };
  };
}
