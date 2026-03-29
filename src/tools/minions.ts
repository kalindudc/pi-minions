import { Type } from "@sinclair/typebox";
import type { Static } from "@sinclair/typebox";
import type { AgentToolResult, ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { AgentTree } from "../tree.js";
import type { ResultQueue } from "../queue.js";
import type { MinionSession } from "../spawn.js";
import { formatDuration, formatUsage } from "../render.js";
import type { DetachHandle } from "./spawn.js";

// list_minions

export const ListMinionsParams = Type.Object({});
export type ListMinionsParams = Static<typeof ListMinionsParams>;

export function listMinions(
  tree: AgentTree,
  queue: ResultQueue,
  detachHandles: Map<string, DetachHandle>,
) {
  return async function execute(
    _toolCallId: string,
    _params: ListMinionsParams,
    _signal: AbortSignal | undefined,
    _onUpdate: unknown,
    _ctx: ExtensionContext,
  ): Promise<AgentToolResult<unknown>> {
    const running = tree.getRunning();
    const pending = queue.getPending();

    if (!running.length && !pending.length) {
      return { content: [{ type: "text", text: "No running or pending minions." }], details: undefined };
    }

    const lines: string[] = [];
    if (running.length) {
      lines.push(`Running (${running.length}):`);
      for (const n of running) {
        // Detach handle exists = foreground (handle is what enables sending to background)
        const mode = detachHandles.has(n.id) ? "foreground" : "background";
        const activity = n.lastActivity ?? n.task.slice(0, 60);
        lines.push(`  ${n.name} (${n.id}) [${mode}] — ${activity}`);
      }
    }
    if (pending.length) {
      lines.push(`Pending results (${pending.length}):`);
      for (const r of pending) {
        lines.push(`  ${r.name} (${r.id}) — ${r.task.slice(0, 60)}`);
      }
    }
    return { content: [{ type: "text", text: lines.join("\n") }], details: undefined };
  };
}

// steer_minion

export const SteerMinionParams = Type.Object({
  target: Type.String({ description: "Minion ID or name to steer" }),
  message: Type.String({ description: "Message to inject into the minion's context before its next LLM call" }),
});
export type SteerMinionParams = Static<typeof SteerMinionParams>;

export function steerMinion(
  tree: AgentTree,
  sessions: Map<string, MinionSession>,
) {
  return async function execute(
    _toolCallId: string,
    params: SteerMinionParams,
    _signal: AbortSignal | undefined,
    _onUpdate: unknown,
    _ctx: ExtensionContext,
  ): Promise<AgentToolResult<unknown>> {
    const node = tree.resolve(params.target);
    if (!node) {
      throw new Error(`Minion not found: ${params.target}`);
    }
    if (node.status !== "running") {
      throw new Error(`Minion ${node.name} (${node.id}) is not running (status: ${node.status}).`);
    }
    const session = sessions.get(node.id);
    if (!session) {
      throw new Error(`No active session for ${node.name} (${node.id}).`);
    }
    await session.steer(params.message);
    return {
      content: [{ type: "text", text: `Steered ${node.name} (${node.id}): ${params.message}` }],
      details: undefined,
    };
  };
}

// show_minion

export const ShowMinionParams = Type.Object({
  target: Type.String({ description: "Minion ID or name to inspect" }),
});
export type ShowMinionParams = Static<typeof ShowMinionParams>;

export function showMinion(
  tree: AgentTree,
  queue: ResultQueue,
) {
  return async function execute(
    _toolCallId: string,
    params: ShowMinionParams,
    _signal: AbortSignal | undefined,
    _onUpdate: unknown,
    _ctx: ExtensionContext,
  ): Promise<AgentToolResult<unknown>> {
    const node = tree.resolve(params.target);
    const result = queue.get(params.target);

    if (!node && !result) {
      throw new Error(`Minion not found: ${params.target}`);
    }

    const lines: string[] = [];
    if (node) {
      lines.push(`${node.name} (${node.id})`);
      lines.push(`  Status: ${node.status}`);
      lines.push(`  Task: ${node.task}`);

      if (node.status === "running") {
        lines.push(`  Running for: ${formatDuration(Date.now() - node.startTime)}`);
        if (node.lastActivity) lines.push(`  Activity: ${node.lastActivity}`);
      }

      if (node.endTime) lines.push(`  Duration: ${formatDuration(node.endTime - node.startTime)}`);
      lines.push(`  Usage: ${formatUsage(node.usage)}`);
      if (node.error) lines.push(`  Error: ${node.error}`);
    }
    if (result) {
      if (!node) lines.push(`${result.name} (${result.id})`);
      lines.push(`  Exit code: ${result.exitCode}`);
      if (result.output) {
        const preview = result.output.split("\n").slice(0, 10).join("\n");
        lines.push(`  Output:\n${preview}`);
      }
    }
    return { content: [{ type: "text", text: lines.join("\n") }], details: undefined };
  };
}
