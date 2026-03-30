# Getting started

> See also: [Patterns](patterns.md) · [Agents](agents.md) · [Reference](reference.md) · [Architecture](architecture.md)

A hands-on walkthrough — from installation to spawning your first minion, running background tasks, and creating a custom agent. About 10 minutes.

## Prerequisites

- [pi](https://github.com/mariozechner/pi-coding-agent) installed and working
- A project directory to work in

## Installation

```bash
pi install https://github.com/kalindudc/pi-minions
```

That's it. pi-minions registers its tools and commands automatically on next session start.

## Your first minion

Start a pi session and spawn a foreground minion:

```bash
/spawn Summarize the directory structure of this project
```

What happens:
1. pi-minions creates an isolated session (a **minion**) with its own context
2. The minion receives your task and starts working — you'll see streaming progress
3. When it finishes, the result is returned directly to your session
4. Your parent session continues with the minion's findings in context

The parent blocks while the minion runs. This is intentional — foreground spawns are for tasks where you need the result before continuing.

> [!TIP]
> You don't have to use commands. Natural language works too — ask the LLM to delegate:
>
> "Use a minion to research the error handling patterns in this codebase"

## Running tasks in the background

For longer tasks, spawn minions in the background:

```bash
/spawn --bg Run the test suite and report any failures
```

The command returns immediately with the minion's name and ID. The minion runs independently, and its result is auto-delivered to your session when it finishes.

Check on running minions:

```bash
/minions
```

This shows all running and pending (completed, awaiting delivery) minions.

## Managing minions

### Check detailed status

```bash
/minions show kevin
```

Shows the minion's task, current activity, output so far, and token usage.

### Steer a running minion

Change a minion's focus mid-execution:

```bash
/minions steer kevin "Focus only on the src/ directory, skip tests"
```

### Detach a slow foreground task

Started a foreground spawn that's taking too long? Detach it to background:

```bash
/minions bg kevin
```

The same session continues in the background — no interruption, no lost progress. The result will be queued and delivered when complete.

### Halt a minion

Stop a minion that's off-track or wasting tokens:

```bash
/halt kevin
```

Or stop everything:

```bash
/halt all
```

## Creating your first agent

Agents are reusable minion configurations. Create one for research tasks:

```bash
mkdir -p .pi/agents

cat > .pi/agents/researcher.md << 'EOF'
---
name: researcher
description: Research topics with structured findings
model: claude-sonnet-4-20250514
steps: 30
---

You are a research agent. Investigate the given topic thoroughly.

- Use tools to search, read files, and gather evidence
- Cite specific file paths and line numbers
- Summarize findings with confidence levels
- Flag areas that need human verification
EOF
```

Now use it:

```bash
/spawn --agent researcher What testing patterns does this project use?
```

The minion runs with your agent's model, step limit, and system prompt instead of the defaults.

See [Agents](agents.md) for the full guide on agent configuration, discovery paths, and frontmatter fields.

## Next steps

- [Patterns](patterns.md) — "How do I...?" recipes for common workflows
- [Agents](agents.md) — Creating and configuring named agents
- [Reference](reference.md) — Complete tool and command schemas
- [Architecture](architecture.md) — How pi-minions works under the hood
