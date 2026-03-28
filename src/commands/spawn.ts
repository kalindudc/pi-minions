import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";

export function parseSpawnArgs(args: string): { task: string; model?: string; background: boolean } | { error: string } {
  const tokens = args.trim().split(/\s+/);

  if (tokens.length === 0 || tokens[0] === "") {
    return { error: "Usage: /spawn <task> [--model <model>] [--bg]" };
  }

  const bgIdx = tokens.indexOf("--bg");
  let background = false;
  if (bgIdx !== -1) {
    background = true;
    tokens.splice(bgIdx, 1);
  }

  const modelFlagIdx = tokens.indexOf("--model");
  let model: string | undefined;
  const remaining: string[] = [];

  if (modelFlagIdx !== -1) {
    const modelValue = tokens[modelFlagIdx + 1];
    if (!modelValue || modelValue.startsWith("--")) {
      return { error: "Usage: /spawn <task> [--model <model>] [--bg] -- --model requires a value" };
    }
    model = modelValue;
    for (let i = 0; i < tokens.length; i++) {
      if (i === modelFlagIdx || i === modelFlagIdx + 1) continue;
      remaining.push(tokens[i]!);
    }
  } else {
    remaining.push(...tokens);
  }

  const task = remaining.join(" ").trim();
  if (!task) {
    return { error: "Usage: /spawn <task> [--model <model>] [--bg] -- task cannot be empty" };
  }

  return { task, model, background };
}

export function createSpawnHandler(pi: ExtensionAPI) {
  return async function handler(args: string, ctx: ExtensionCommandContext): Promise<void> {
    const parsed = parseSpawnArgs(args);
    if ("error" in parsed) {
      ctx.ui.notify(parsed.error, "error");
      return;
    }

    const tool = parsed.background ? "spawn_bg" : "spawn";
    let directive = `Use the ${tool} tool to delegate this task to a minion: ${parsed.task}`;
    if (parsed.model) directive += `\nSet the model override to: ${parsed.model}`;
    pi.sendUserMessage(directive);
  };
}
