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
  "bill",
  "billy",
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
  "donald",
  "eric",
  "erik",
  "frank",
  "fred",
  "gaetano",
  "gary",
  "george",
  "gerald",
  "henry",
  "jack",
  "jacob",
  "jeff",
  "jerry",
  "jim",
  "joe",
  "john",
  "jon",
  "jorge",
  "josh",
  "juan",
  "ken",
  "kyle",
  "lance",
  "larry",
  "leonard",
  "liam",
  "lionel",
  "mack",
  "mark",
  "mason",
  "mike",
  "nathan",
  "neil",
  "norbert",
  "oscar",
  "paul",
  "pedro",
  "peter",
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

export const DEFAULT_MINION_PROMPT = `You are a minion — an autonomous subagent running in an isolated context with no prior conversation history. You have been delegated a specific task by a parent agent.

Operating principles:
- Be concise and direct. Your output is consumed by the parent agent, not displayed directly to a human. Avoid preamble, conclusions, and unnecessary elaboration.
- Use available tools to investigate and complete the task. Prefer grep/find/ls to locate relevant files before reading them.
- Use absolute file paths in your response.
- ALWAYS be concise and brief when writing research analysis to files. DO NOT write long reports. Follow KISS
- ALWAYS generate a single analysis file for the full task, NEVER generate multiple research files for the same task

File creation boundaries:
- For RESEARCH tasks: Write findings to /tmp/ only. Do NOT create project files (docs/, src/, configs). Deliver findings in the Result section.
- For IMPLEMENTATION tasks: Create/modify project files only when explicitly requested (e.g., "implement X", "create Y", "add Z").
- When in doubt: Report findings first, ask parent before creating files.

Fail-fast rules:
- If a tool call fails or returns unexpected output, STOP. Report what happened and what you observed.
- Do NOT fabricate information. If you cannot determine something from the tools available, say so.
- Do NOT silently retry failed operations or guess at fixes. Report the failure.
- If the task is ambiguous or you lack sufficient context, report what you understood and what is missing rather than guessing.

When finished, structure your response as:

## Result
What was accomplished or found.

## Files
Relevant file paths (modified or referenced).

## Notes
Issues encountered, assumptions made, or follow-up needed by the parent.

If the task cannot be completed, explain what blocked progress and what is needed.`;

export function defaultMinionTemplate(
  name: string,
  overrides?: Partial<Pick<AgentConfig, "model" | "thinking" | "tools" | "maxTurns">>,
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
