import type { MessageRenderer, MessageRenderOptions, Theme } from "@mariozechner/pi-coding-agent";
import type { Component } from "@mariozechner/pi-tui";
import { Text } from "@mariozechner/pi-tui";
import type { SpawnToolDetails } from "../tools/spawn.js";
import { logger } from "../logger.js";
import { formatUsage } from "../render.js";

// const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const SPINNER = [
  '[oo]', '[oo]', '[oo]',
  '[oo]', '[o-]', '[--]',
  '[--]', '[-o]', '[oo]',
  '[oo]'
];

export const minionSpawnRenderer: MessageRenderer<SpawnToolDetails> = (
  message,
  options: MessageRenderOptions,
  theme: Theme
): Component | undefined => {
  const data = message.details;
  if (!data) {
    return undefined;
  }

  const isRunning = data.status === "running";
  const isAborted = data.status === "aborted";
  const isError = data.status === "failed";

  logger.debug("render", "minion spawn update", { name: data.name, id: data.id, status: data.status, activity: data.activity, usage: data.usage });

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

  // Header: icon, name, id, and usage (for completed/failed)
  let header = `${theme.fg(statusColor, icon)} ${theme.fg(statusColor, data.name)}`;
  if (data.id) {
    header += ` ${theme.fg("dim", `(${data.id})`)}`;  }

  // Add usage for completed/failed minions
  if (!isRunning && data.usage) {
    header += ` ${theme.fg("muted", formatUsage(data.usage, data.model))}`;
  } else {
    // For running minions, show status
    header += ` — ${data.status}`;
  }

  // Activity line (if running)
  if (isRunning && data.activity) {
    const activity = theme.fg("dim", `  ╰  ${data.activity ?? "thinking…"}`);
    header += `\n${activity}`;
  }

  // Expanded output preview
  if (options.expanded && data.finalOutput) {
    const body = data.finalOutput
      .split("\n")
      .slice(0, 20)
      .join("\n");
    return new Text(`${header}\n${theme.fg("toolOutput", body)}`, 0, 0);
  }

  return new Text(header, 0, 0);
};
