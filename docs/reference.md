# Reference

> See also: [Getting started](getting-started.md) · [Patterns](patterns.md) · [Agents](agents.md) · [Architecture](architecture.md)

## Quick reference

| Name | Type | Purpose |
|------|------|---------|
| [`spawn`](#spawn--spawn_bg) | Tool | Foreground task delegation (blocks until complete) |
| [`spawn_bg`](#spawn--spawn_bg) | Tool | Background task delegation (returns immediately) |
| [`halt`](#halt) | Tool | Abort running minion(s) |
| [`list_agents`](#list_agents) | Tool | Discover available named agents |
| [`list_minion_types`](#list_minion_types) | Tool | List running and pending minions |
| [`show_minion`](#show_minion) | Tool | Detailed minion status |
| [`steer_minion`](#steer_minion) | Tool | Inject message into running minion |
| [`/spawn`](#spawn-1) | Command | Spawn minion (user-initiated) |
| [`/minions`](#minions) | Command | Manage minions |
| [`/halt`](#halt-1) | Command | Abort minion(s) |

---

## Tools (LLM-callable)

### spawn / spawn_bg

Delegate tasks to foreground or background minions.

**Schema (single task):**
```typescript
{ task: string; agent?: string; model?: string }
```

**Schema (batch — multiple minions):**
```typescript
{ tasks: Array<{ task: string; agent?: string; model?: string }> }
```

| Aspect | `spawn` (foreground) | `spawn_bg` (background) |
|--------|---------------------|------------------------|
| **Parent blocks?** | Yes, until complete | No, returns immediately |
| **Result delivery** | Tool call return value | Auto-queued, delivered next turn |
| **Use when** | Need result to proceed | Long-running, parallel work |
| **Detachable?** | Yes, via `/minions bg` | N/A (already detached) |
| **Batch mode?** | Yes, via `tasks` array | No |

**Returns:**
```typescript
// spawn (foreground)
{ exitCode: 0 | 1; finalOutput: string; usage: { input, output, cacheRead, cacheWrite, cost, turns } }

// spawn_bg (background)
{ id: string; name: string; status: "running" }
```

**Key behaviors:**
- Use `tasks` array to spawn multiple minions in parallel under one render block
- Creates an isolated in-process session (see [Architecture — In-process sessions](architecture.md#in-process-sessions-over-child-processes))
- Streams progress via `session.subscribe()`
- Abortable via `halt` tool or `/halt` command
- Inherits parent configuration (system prompt, extensions, skills, themes)
- Filters pi-minions extension to prevent recursive spawning
- Foreground: parent abort signal connected; detachable via `/minions bg`
- Background: result auto-delivered via `pi.sendMessage({ deliverAs: "nextTurn" })`

> [!NOTE]
> When a foreground spawn result contains `[USER ACTION]`, the user detached the minion to background via `/minions bg`. The same session continues — no interruption.

See [Patterns — How to delegate a blocking task](patterns.md) for usage examples.

---

### halt

Abort a running minion by ID or name.

**Schema:**
```typescript
{ id: string }
```

**Example:** `halt({ id: "researcher" })` or `halt({ id: "all" })`

**Returns:** Confirmation message (e.g., "Halted minion researcher (a1b2c3d4).")

> [!WARNING]
> Halt throws an error so pi renders a red `[HALTED]` banner. The system prompt instructs the LLM: "do NOT retry when `[HALTED]`."

See [Patterns — How to abort and retry](patterns.md) for the abort-and-respawn workflow.

---

### list_agents

Discover available named agents.

**Schema:** `{}` (no parameters)

**Returns:**
```typescript
{ agents: Array<{ name: string; description: string; file: string }> }
```

Discovers agents from global and project directories. See [Agents — Where to put agents](agents.md#where-to-put-agents) for the full discovery path list.

---

### list_minion_types

List running and pending minions.

**Schema:** `{}` (no parameters)

**Returns:**
```typescript
{
  running: Array<{ id, name, task, status: "running", mode: "foreground" | "background", lastActivity }>,
  pending: Array<{ id, name, task, status: "pending", completedAt }>
}
```

---

### show_minion

Detailed status for one minion.

**Schema:**
```typescript
{ target: string }
```

**Returns:**
```typescript
{ id, name, task, status, mode, lastActivity, output: string, usage: { input, output, cost, turns } }
```

---

### steer_minion

Inject a message into a running minion's context.

**Schema:**
```typescript
{ target: string; message: string }
```

**Returns:** `{ id, name, steered: true }`

> [!NOTE]
> The message is injected before the minion's next LLM call, not instantaneously. There may be a delay if the minion is mid-tool-execution.

See [Patterns — How to redirect a running minion](patterns.md) for steering examples.

---

## Commands (user-initiated)

### /spawn

**Syntax:** `/spawn [--bg] [--agent NAME] [--model MODEL] <task>`

| Flag | Effect |
|------|--------|
| `--bg` | Run in background |
| `--agent NAME` | Use named agent |
| `--model MODEL` | Model override |

**Examples:**
```bash
/spawn Research TypeScript 5.7 features
/spawn --bg --agent researcher Compare React 19 vs Vue 3.5
/spawn --model claude-sonnet-4-20250514 Review security implications
```

---

### /minions

Manage running minions.

| Subcommand | Syntax | Purpose |
|------------|--------|---------|
| `list` | `/minions` or `/minions list` | Show running and pending |
| `show` | `/minions show <id\|name>` | Detailed view |
| `bg` | `/minions bg <id\|name>` | Send to background (live detach) |
| `steer` | `/minions steer <id\|name> <msg>` | Inject message |

---

### /halt

**Syntax:** `/halt <id|name|all>`

Abort one or all running minions.

---

## Types

| Type | Key fields |
|------|-----------|
| `AgentConfig` | `name, description, systemPrompt, model?, tools?, thinking?, steps?, timeout?, source, filePath` |
| `SpawnResult` | `exitCode, finalOutput, usage: UsageStats, error?` |
| `AgentNode` | `id, name, task, status, parentId?, children[], usage, startTime, endTime?, lastActivity?` |
| `QueuedResult` | `id, name, task, output, usage, status, completedAt, duration, exitCode, error?` |
| `UsageStats` | `input, output, cacheRead, cacheWrite, cost, contextTokens, turns` |

---

## Configuration

### Environment variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PI_MINIONS_DEBUG` | Enable debug logging | `0` |
| `PI_MINIONS_TIMEOUT` | Global timeout for all minions (ms). 30s grace period before force abort. | Unlimited |

### Safety configuration

Configure per-agent via frontmatter or globally via environment variables. See [Agents — Frontmatter reference](agents.md#frontmatter-reference) for the full field list.

| Setting | Frontmatter | Env var | Behavior |
|---------|-------------|---------|----------|
| **Step limit** | `steps: 30` | — | Graceful steer at limit, force abort after 2 grace turns |
| **Timeout** | `timeout: 60000` | `PI_MINIONS_TIMEOUT` | Graceful steer at expiry, force abort after 30s grace |

Per-agent `timeout` overrides `PI_MINIONS_TIMEOUT`. Step limits are per-agent only.

---

## Logging

| Log type | Location | Contents | Enable |
|----------|----------|----------|--------|
| **Debug** | `/tmp/logs/pi-minions/debug.log` | Extension lifecycle, spawn events, errors. `info`/`warn`/`error` always logged; `debug` respects `PI_MINIONS_DEBUG`. | `PI_MINIONS_DEBUG=1` (for debug level) |
| **Transcripts** | `/tmp/logs/pi-minions/minions/<id>-<name>.log` | Per-minion conversation (tool calls, output deltas, messages) | Always on |

> For design decisions and architecture, see [Architecture](architecture.md).
