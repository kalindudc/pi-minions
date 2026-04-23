# Agents

> See also: [Architecture](architecture.md) · [Reference](reference.md) · [Patterns](patterns.md)

## What is an agent?

An **agent** is a named markdown file with YAML frontmatter that defines a reusable minion configuration — model, tools, safety limits, and a system prompt. When you spawn a named agent, pi-minions uses its config instead of the default ephemeral minion template.

Without an agent, you get an **ephemeral minion** — a generic session with a default prompt. Named agents let you create specialized minions for repeated tasks (research, review, testing) with consistent behavior.

## Creating an agent

An agent file is a `.md` file with YAML frontmatter followed by a system prompt body:

```markdown
---
name: researcher
description: Research topics with citation tracking
model: claude-sonnet-4-20250514
steps: 30
timeout: 60000
---

You are a research agent. Investigate the given topic thoroughly.

- Use tools to search, read files, and gather evidence
- Cite specific file paths and line numbers
- Summarize findings with confidence levels
- Flag areas that need human verification
```

The frontmatter configures the minion's behavior. The body after the `---` becomes the system prompt.

> [!NOTE]
> The `description` field is required — agents without a description are silently skipped during discovery.

### Example: agent with safety limits

```markdown
---
name: quick-check
description: Fast validation with strict limits
model: claude-haiku-4-5
steps: 10
timeout: 30000
tools: read, bash, grep
thinking: low
---

You are a quick validation agent. Check the given claim efficiently.

Stay focused. You have limited steps — get in, verify, report, get out.
```

## Where to put agents

| Location | Scope | Walk-up? | Override priority |
|----------|-------|----------|-------------------|
| `~/.pi/agent/agents/` | Global | No | 1 (lowest) |
| `~/.pi/agent/minions/` | Global | No | 2 |
| `~/.agents/agents/` | Global | No | 3 |
| `~/.agents/minions/` | Global | No | 4 |
| `.pi/agents/` | Project | Yes (to git root) | 5 |
| `.pi/minions/` | Project | Yes (to git root) | 6 |
| `.agents/agents/` | Project | Yes (to git root) | 7 |
| `.agents/minions/` | Project | Yes (to git root) | 8 (highest) |

- **Global** agents are available in every project
- **Project** agents live in the repo and are shared with collaborators
- Project agents override global agents on name collision
- "Walk-up" means pi-minions searches from the current directory up to the nearest `.git` root
- Each discovery directory loads top-level `*.md` files and immediate child folders containing `MINION.md`

> [!TIP]
> Put team-shared agents in `.pi/agents/` or `.pi/minions/` (committed to the repo). Put personal agents in `~/.pi/agent/agents/`, `~/.pi/agent/minions/`, `~/.agents/agents/`, or `~/.agents/minions/`.

## Discovering and using agents

### List available agents

The `list_agents` tool (or natural language like "what agents are available?") shows all discovered agents:

```bash
# LLM calls list_agents automatically, or check manually:
ls ~/.pi/agent/agents/
ls ~/.pi/agent/minions/
ls .pi/agents/
ls .pi/minions/
```

### Spawn a named agent

```bash
# Via command
/spawn --agent researcher Research TypeScript 5.7 features

# Via command with model override
/spawn --agent researcher --model claude-haiku-4-5 Quick summary of changes

# Background
/spawn --bg --agent researcher Deep dive into migration options
```

The LLM can also spawn agents naturally — just ask it to use a specific agent:

> "Use the researcher agent to investigate the performance regression"

### Model override

The `--model` flag (or `model` parameter in the tool call) overrides the agent's configured model for a single spawn. The agent's other settings (prompt, steps, timeout) are preserved.

## Frontmatter reference

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `name` | `string` | No | Filename (without `.md`) | Agent name used in `--agent` flag and `list_agents` |
| `description` | `string` | Yes | — | One-line description shown in `list_agents`. **Agents without a description are skipped.** |
| `model` | `string` | No | Parent's model | Model ID (e.g., `claude-sonnet-4-20250514`, `claude-haiku-4-5`) |
| `thinking` | `string` | No | — | Thinking level: `off`, `minimal`, `low`, `medium`, `high`, `xhigh` |
| `tools` | `string` | No | All tools | Comma-separated tool names to allow (e.g., `read, bash, grep`) |
| `steps` | `number` | No | Unlimited | Max turns before graceful termination. 2 grace turns after limit. |
| `timeout` | `number` | No | `PI_MINIONS_TIMEOUT` or unlimited | Timeout in milliseconds. 30s grace period after expiry. |

> [!NOTE]
> OpenCode-compatible: `max_turns` is accepted as an alias for `steps`. Unknown frontmatter fields (like `mode`, `temperature`, `color`) are silently ignored.

### How safety limits work

When a step limit or timeout is reached, the minion receives a steering message asking it to wrap up. If it finishes within the grace window (2 turns for steps, 30 seconds for timeout), it exits cleanly. Otherwise, it's force-aborted.

See [Architecture — Safety controls](architecture.md#safety-controls) for the full termination flow.
