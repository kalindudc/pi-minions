export const MINIONS_SKILL = `# pi-minions

Use minions when independent work can run in isolated foreground agent sessions and you need the result before continuing.

Available surfaces:
- Use the \`spawn\` tool for a single foreground minion. Provide \`task\`, optional \`agent\`, and optional \`model\`.
- Use \`spawn\` with a \`tasks\` array to run multiple foreground minions in parallel. Each item accepts \`task\`, optional \`agent\`, and optional \`model\`.
- Use \`list_agents\` before selecting named agents when you are unsure what is available.
- Use \`halt\` with a minion id, name, or \`all\` to abort running foreground minions.
- Use \`list_minions\` to see current foreground minion activity.
- Use \`show_minion\` or \`/minions show <id|name>\` to inspect detailed foreground activity.

Background minions are not available.
Live detach is not available.
User steering is not available.
`;

export function getMinionsSkill(): string {
  return MINIONS_SKILL;
}
