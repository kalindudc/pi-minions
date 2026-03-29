import type { AgentTree } from "./tree.js";
import type { AgentConfig } from "./types.js";

export const MINION_NAMES = [
  // core
  "kevin",
  "stuart",
  "bob",
  "otto",
  "mel",

  "adrian",
  "alan",
  "arnie",
  "barry",
  "beena",
  "billy",
  "bina",
  "bobby",
  "brad",
  "brett",
  "brian",
  "bruno",
  "cameron",
  "carl",
  "chris",
  "claude",
  "dan",
  "dave",
  "devin",
  "donny",
  "eric",
  "erik",
  "frank",
  "fred",
  "gaetano",
  "gary",
  "george",
  "gerald",
  "gigi",
  "henry",
  "jack",
  "jacob",
  "jeff",
  "jim",
  "joe",
  "john",
  "jon",
  "jorge",
  "juan",
  "ken",
  "keela",
  "koko",
  "kyle",
  "lance",
  "larry",
  "leonard",
  "liam",
  "lionel",
  "lola",
  "lulu",
  "mack",
  "mark",
  "mason",
  "mike",
  "mimi",
  "momo",
  "nana",
  "nathan",
  "neil",
  "norbert",
  "oscar",
  "paul",
  "pedro",
  "peter",
  "pip",
  "pippa",
  "ralph",
  "raymond",
  "robert",
  "ron",
  "ryan",
  "samson",
  "scott",
  "spencer",
  "steve",
  "ted",
  "tim",
  "tom",
  "tony",
  "trevor",
  "vincent",
  "zack",
  "ziggy",
] as const;

export function generateId(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 8);
}

export function pickMinionName(tree: AgentTree, fallbackId: string): string {
  const inUse = new Set(tree.getRunning().map((n) => n.name));
  const available = MINION_NAMES.filter((n) => !inUse.has(n));
  if (available.length === 0) return `minion-${fallbackId}`;
  return available[Math.floor(Math.random() * available.length)]!;
}

export const DEFAULT_MINION_PROMPT = `You are a minion — an autonomous subagent in an isolated context with no conversation history. Be concise; your output goes to a parent agent, not a human.

Use tools to investigate and complete the task. Prefer grep/find/ls before reading files. Use absolute paths.

File boundaries: research output goes to /tmp/ only.
Project files can be modified only when explicitly requested.
When in doubt, report findings first.

On failure: STOP. Report what happened. Do NOT fabricate information. Do NOT silently retry.

Respond with:

## Result
What was accomplished or found.

## Files
File paths modified or referenced.

## Notes
Issues, assumptions, or follow-up needed.`;

export function defaultMinionTemplate(
  name: string,
  overrides?: Partial<Pick<AgentConfig, "model" | "thinking" | "tools" | "steps" | "timeout">>,
): AgentConfig {
  return {
    name,
    description: "Ephemeral minion",
    systemPrompt: DEFAULT_MINION_PROMPT,
    source: "ephemeral",
    filePath: "",
    ...overrides,
  };
}
