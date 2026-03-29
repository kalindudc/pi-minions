import type { AgentToolResult } from "@mariozechner/pi-coding-agent";
import type { Theme, ToolRenderResultOptions } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import type { UsageStats } from "./types.js";
import type { SpawnToolDetails } from "./tools/spawn.js";

// Formatting helpers

export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10_000) return `${(n / 1000).toFixed(1)}k`;
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const rem = secs % 60;
  return `${mins}m ${rem}s`;
}

export function formatToolCall(name: string, args: Record<string, unknown>): string {
  if (name === "bash") {
    const cmd = String(args["command"] ?? "");
    const truncated = cmd.length > 60 ? `${cmd.slice(0, 60)}...` : cmd;
    return `$ ${truncated}`;
  }
  if (name === "read") {
    const path = String(args["path"] ?? args["file_path"] ?? "");
    return `read ${path}`;
  }
  const preview = JSON.stringify(args);
  const truncated = preview.length > 50 ? `${preview.slice(0, 50)}...` : preview;
  return `${name} ${truncated}`;
}

export function formatUsage(usage: UsageStats, model?: string): string {
  const parts: string[] = [];

  if (usage.turns) parts.push(`${usage.turns} turn${usage.turns !== 1 ? "s" : ""}`);
  if (usage.input) parts.push(`↑${formatTokens(usage.input)}`);
  if (usage.output) parts.push(`↓${formatTokens(usage.output)}`);

  if (usage.cost) parts.push(`$${usage.cost.toFixed(4)}`);
  if (usage.contextTokens) parts.push(`ctx:${formatTokens(usage.contextTokens)}`);
  if (model) parts.push(model);

  return parts.join(" ");
}

// TUI render functions

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export function renderCall(
  args: Record<string, unknown>,
  theme: Theme,
  _ctx: unknown,
): Text {
  const agentName = args["agent"] ? String(args["agent"]) : undefined;
  const task = String(args["task"] ?? "");
  const taskPreview = task.length > 60 ? `${task.slice(0, 60)}…` : task;
  const model = args["model"] ? ` [${args["model"]}]` : "";

  const label = agentName
    ? theme.fg("accent", agentName)
    : theme.fg("muted", taskPreview);

  const text =
    theme.fg("toolTitle", theme.bold("spawn ")) +
    label +
    theme.fg("dim", model);
  return new Text(text, 0, 0);
}

export function renderResult(
  result: AgentToolResult<SpawnToolDetails>,
  { expanded, isPartial }: ToolRenderResultOptions,
  theme: Theme,
  ctx: { isError: boolean; state?: { cachedName?: string; cachedId?: string } },
): Text {
  const details = result.details;
  const isError = ctx.isError;

  // Streaming: show activity while the minion is running
  if (isPartial && details) {
    // Cache name/id in render state so they survive tool errors
    if (ctx.state) {
      ctx.state.cachedName = details.name;
      ctx.state.cachedId = details.id;
    }

    const frame = SPINNER[(details.spinnerFrame ?? 0) % SPINNER.length];
    const activity = details.activity ?? "thinking…";
    const hint = theme.fg("dim", `  ·  /minions bg ${details.name ?? ""}`);
    const line =
      theme.fg("accent", frame) + " " +
      theme.fg("accent", details.name ?? "minion") +
      (details.id ? theme.fg("dim", ` (${details.id})`) : "") +
      hint +
      "\n" + theme.fg("dim", `  ⎿  ${activity}`);
    return new Text(line, 0, 0);
  }

  // Prefer details, fall back to cached state from streaming phase (details is
  // undefined when the tool errors, so the cache preserves identity for display)
  const name = details?.name ?? ctx.state?.cachedName ?? "minion";
  const id = details?.id ?? ctx.state?.cachedId;

  // Completed / failed / aborted
  const isAborted = details?.status === "aborted";
  const isBad = isAborted || isError;
  const icon = isAborted
    ? theme.fg("warning", "■")
    : isError ? theme.fg("error", "✗") : theme.fg("success", "✓");
  const nameColor = isBad ? "error" : "success";

  const header =
    `${icon} ` +
    theme.fg(nameColor, name) +
    (id ? theme.fg("dim", ` (${id})`) : "") +
    (details?.usage ? " " + theme.fg("muted", formatUsage(details.usage, details.model)) : "");

  if (!expanded || !details?.finalOutput) {
    return new Text(header, 0, 0);
  }

  const body = details.finalOutput
    .split("\n")
    .slice(0, 20)
    .join("\n");

  return new Text(`${header}\n${theme.fg("toolOutput", body)}`, 0, 0);
}
