import type { MessageRenderer, MessageRenderOptions, Theme } from "@mariozechner/pi-coding-agent";
import { getMarkdownTheme } from "@mariozechner/pi-coding-agent";
import type { Component } from "@mariozechner/pi-tui";
import { Box, Markdown, Text } from "@mariozechner/pi-tui";
import { logger } from "../logger.js";

export interface MinionCompleteDetails {
  id: string;
  name: string;
  task: string;
  exitCode: number;
  error?: string;
  duration: number;
  output?: string;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = ((ms % 60000) / 1000).toFixed(0);
  return `${minutes}m ${seconds}s`;
}

export const minionCompleteRenderer: MessageRenderer<MinionCompleteDetails> = (
  message,
  _options: MessageRenderOptions,
  theme: Theme,
): Component | undefined => {
  logger.debug("minion-complete:renderer", "render-called", {
    hasDetails: !!message?.details,
    hasId: !!message?.details?.id,
    hasName: !!message?.details?.name,
    hasContent: !!message?.content,
  });

  const data = message.details;
  if (!data?.id || !data?.name) {
    logger.debug("minion-complete:renderer", "missing-required-fields-returning-undefined");
    return undefined;
  }

  const isSuccess = data.exitCode === 0;
  const statusIcon = isSuccess ? "✓" : "✗";
  const statusColor = isSuccess ? "success" : "error";
  const statusText = isSuccess ? "completed" : "failed";

  // Build header line with icon, name, id, and status
  const headerLine = `${theme.fg(statusColor, statusIcon)} ${theme.fg("text", data.name)} ${theme.fg("dim", `(${data.id})`)} ${theme.fg("dim", "—")} ${theme.fg(statusColor, statusText)}`;

  logger.debug("minion-complete:renderer", "creating-component", {
    name: data.name,
    exitCode: data.exitCode,
    isSuccess,
  });

  // Build header as plain text
  let headerText = `${headerLine}\n\n${theme.fg("accent", "Task:")} ${theme.fg("text", data.task)}\n${theme.fg("accent", "Duration:")} ${theme.fg("text", formatDuration(data.duration))}`;

  if (data.error) {
    headerText += `\n${theme.fg("error", `Error: ${data.error}`)}`;
  }

  // Wrap in Box with tool success/error background like built-in tool outputs
  const bgColor = isSuccess ? "toolSuccessBg" : "toolErrorBg";
  const box = new Box(1, 1, (text) => theme.bg(bgColor, text));

  // Add header text
  box.addChild(new Text(headerText, 0, 0));

  // Render the raw output as Markdown
  const output = data.output || "(no output)";
  box.addChild(new Markdown(output, 0, 0, getMarkdownTheme()));

  return box;
};
