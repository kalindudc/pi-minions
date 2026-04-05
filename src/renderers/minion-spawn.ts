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
  let name = data.name;
  let agentName = data.agentName;
  let status = data.status;
  let usage = data.usage;
  let finalOutput = data.finalOutput;
  let activity = data.activity;
  let spinnerFrame = data.spinnerFrame;
  let model = data.model;
  let id = data.id;
  if (data.minions && data.minions.length > 0) {
    // If we have batch minions but only one, render it as a single minion for better detail
    name = data.minions[0].name;
    agentName = data.minions[0].agentName;
    status = data.minions[0].status;
    usage = data.minions[0].usage;
    finalOutput = data.minions[0].finalOutput;
    activity = data.minions[0].activity;
    spinnerFrame = data.minions[0].spinnerFrame;
    model = data.minions[0].model;
    id = data.minions[0].id;
  }

  const isRunning = status === "running";
  const isAborted = status === "aborted";
  const isError = status === "failed";

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
    const frame = SPINNER[(spinnerFrame ?? 0) % SPINNER.length];
    icon = frame;
    statusColor = "accent";
  } else {
    icon = "✓";
    statusColor = "success";
  }

  // Header: icon, agent type (if not ephemeral), name, id, and usage
  let header = `${theme.fg(statusColor, icon)}`;

  // Add agent type if it's not the default ephemeral minion
  if (agentName && agentName !== "ephemeral") {
    header += ` ${theme.fg("success", agentName)}`;
  }

  header += ` ${theme.fg(statusColor, name)}`;
  if (id) {
    header += ` ${theme.fg("dim", `(${id})`)}`;
  }

  // Add usage
  const usageText = formatUsage(usage, model);
  if (usageText) {
    header += `  ${theme.fg("muted", `—  ${usageText}`)}`;
  }

  // Activity line (if running)
  let body = "";
  if (isRunning && activity) {
    body = `${theme.fg("dim", `  │`)}\n${theme.fg("dim", `  ╰  ${activity ?? "thinking…"}`)}`;
  }

  // Expanded output preview
  if (options.expanded && finalOutput) {
    const preview = finalOutput.split("\n").slice(0, 20).join("\n");
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

  if (data.isBatch && data.minions && data.minions.length > 1) {
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
