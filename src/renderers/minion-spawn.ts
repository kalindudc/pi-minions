import type { MessageRenderOptions, Theme } from "@mariozechner/pi-coding-agent";
import type { Component } from "@mariozechner/pi-tui";
import { Text } from "@mariozechner/pi-tui";
import { formatUsage } from "../render.js";
import type { SpawnToolDetails } from "../tools/spawn.js";

// Structured render result with separate sections for flexible composition
export interface SpawnRenderResult {
  header?: string;
  body: string;
  footer?: string;
}

// const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const SPINNER = ["[oo]", "[oo]", "[oo]", "[oo]", "[o-]", "[--]", "[--]", "[-o]", "[oo]", "[oo]"];

export function renderBatchMinions(
  data: SpawnToolDetails,
  _options: MessageRenderOptions,
  theme: Theme,
): SpawnRenderResult {
  const minions = data.minions ?? [];

  const lines: string[] = [];

  for (const m of minions) {
    const isDetached = m.detached;
    const isRunning = m.status === "running" && !isDetached;
    const isAborted = m.status === "aborted";
    const isError = m.status === "failed";
    const isCompleted = m.status === "completed";

    let icon: string;
    if (isDetached) {
      icon = "▢";
    } else if (isAborted) {
      icon = "■";
    } else if (isError) {
      icon = "✗";
    } else if (isCompleted) {
      icon = "✓";
    } else {
      icon = SPINNER[(m.spinnerFrame ?? 0) % SPINNER.length];
    }

    let color: "accent" | "warning" | "error" | "success" | "text" | "muted" | "dim";
    if (isDetached) {
      color = "muted";
    } else if (isCompleted) {
      color = "success";
    } else if (isAborted) {
      color = "warning";
    } else if (isError) {
      color = "error";
    } else if (isRunning) {
      color = "accent";
    } else {
      color = "text";
    }

    // Build line with icon, agent type (if not ephemeral), and name
    let line = `${theme.fg(color, icon)}`;

    // Add agent type if it's not the default ephemeral minion
    if (m.agentName && m.agentName !== "ephemeral") {
      line += ` ${theme.fg("success", m.agentName)}`;
    }

    line += ` ${theme.fg(color, m.name)}`;

    if (isDetached) {
      line += ` ${theme.fg("dim", "sent to background")}`;
    } else if (isRunning && m.activity) {
      line += ` ${theme.fg("dim", m.activity.slice(0, 40))}`;
    }

    lines.push(line);
  }

  // Build footer with usage info
  const usageText = formatUsage(data.usage, data.model);
  const footer = usageText ? theme.fg("muted", usageText) : undefined;

  return {
    body: lines.join("\n"),
    footer,
  };
}

export function renderSingleMinion(
  data: SpawnToolDetails,
  options: MessageRenderOptions,
  theme: Theme,
): SpawnRenderResult {
  const isRunning = data.status === "running";
  const isAborted = data.status === "aborted";
  const isError = data.status === "failed";

  // Status icon and color
  let icon: string;
  let statusColor: "accent" | "warning" | "error" | "success" | "text" | "muted" | "dim";
  if (isAborted) {
    icon = "■";
    statusColor = "warning";
  } else if (isError) {
    icon = "✗";
    statusColor = "error";
  } else if (isRunning) {
    const frame = SPINNER[(data.spinnerFrame ?? 0) % SPINNER.length];
    icon = frame;
    statusColor = "accent";
  } else {
    icon = "✓";
    statusColor = "success";
  }

  // Header: icon, agent type (if not ephemeral), name, id, and usage
  let header = `${theme.fg(statusColor, icon)}`;

  // Add agent type if it's not the default ephemeral minion
  if (data.agentName && data.agentName !== "ephemeral") {
    header += ` ${theme.fg("success", data.agentName)}`;
  }

  header += ` ${theme.fg(statusColor, data.name)}`;
  if (data.id) {
    header += ` ${theme.fg("dim", `(${data.id})`)}`;
  }

  // Add usage
  const usage = formatUsage(data.usage, data.model);
  if (usage) {
    header += `  ${theme.fg("muted", `—  ${usage}`)}`;
  }

  // Activity line (if running)
  let body = "";
  if (isRunning && data.activity) {
    body = `${theme.fg("dim", `  ╰  ${data.activity ?? "thinking…"}`)}\n${theme.fg("dim", `  │`)}`;
  }

  // Expanded output preview
  if (options.expanded && data.finalOutput) {
    const preview = data.finalOutput.split("\n").slice(0, 20).join("\n");
    body += (body ? "\n" : "") + theme.fg("toolOutput", preview);
  }

  return {
    header,
    body,
  };
}

export function minionSpawnRenderer(
  message: { details?: SpawnToolDetails },
  options: MessageRenderOptions,
  theme: Theme,
): SpawnRenderResult | undefined {
  const data = message.details;
  if (!data) {
    return undefined;
  }

  if (data.isBatch && data.minions) {
    return renderBatchMinions(data, options, theme);
  }

  return renderSingleMinion(data, options, theme);
}

// Wrapper for pi.registerMessageRenderer that returns Text component
export function minionSpawnMessageRenderer(
  message: { details?: SpawnToolDetails },
  options: MessageRenderOptions,
  theme: Theme,
): Component | undefined {
  const result = minionSpawnRenderer(message, options, theme);
  if (!result) return undefined;

  const parts: string[] = [];
  if (result.header) parts.push(result.header);
  if (result.body) parts.push(result.body);
  if (result.footer) parts.push(result.footer);

  return new Text(parts.join("\n"), 0, 0);
}
