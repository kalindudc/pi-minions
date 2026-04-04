import type { AgentToolResult, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { discoverAgents } from "../agents.js";

export const ListAgentsParams = Type.Object(
  {},
  {
    description:
      "List all available agents that can be spawned as minions. No parameters required.",
  },
);

export interface AgentInfo {
  name: string;
  description: string;
  source: string;
  model?: string;
}

export function listAgents() {
  return async function execute(
    _toolCallId: string,
    _params: Record<string, never>,
    _signal: AbortSignal | undefined,
    _onUpdate: undefined,
    ctx: ExtensionContext,
  ): Promise<AgentToolResult<AgentInfo[]>> {
    const { agents } = discoverAgents(ctx.cwd, "both");

    const lines: string[] = [];

    // Built-in ephemeral minion (always available)
    lines.push(
      "- minion (built-in): General-purpose ephemeral minion with default capabilities. Used when no agent name is specified.",
    );

    for (const a of agents) {
      const model = a.model ? ` [model: ${a.model}]` : "";
      lines.push(`- ${a.name} (${a.source}): ${a.description}${model}`);
    }

    const details: AgentInfo[] = [
      {
        name: "minion",
        description: "General-purpose ephemeral minion",
        source: "built-in",
      },
      ...agents.map((a) => ({
        name: a.name,
        description: a.description,
        source: a.source,
        model: a.model,
      })),
    ];

    return {
      content: [{ type: "text", text: `Available agents:\n${lines.join("\n")}` }],
      details,
    };
  };
}
