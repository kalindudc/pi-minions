# API Reference

## Tools (LLM-Callable)

### spawn / spawn_bg

Delegate tasks to foreground or background minions.

**Schema:**
```typescript
{ task: string; agent?: string; model?: string; }
```

**Comparison:**

| Aspect | `spawn` (foreground) | `spawn_bg` (background) |
|--------|---------------------|------------------------|
| **Parent blocks?** | Yes, until complete | No, returns immediately |
| **Result delivery** | Tool call return value | Auto-queued, delivered next turn |
| **Use when** | Need result to proceed | Long-running, parallel work |
| **Detachable?** | Yes, via `/minions bg` | N/A (already detached) |
| **Example** | `spawn({ task: "Analyze logs" })` | `spawn_bg({ task: "Run tests" })` |

**Returns:**
```typescript
// spawn
{ exitCode: 0|1; finalOutput: string; usage: { inputTokens, outputTokens, totalCost } }

// spawn_bg  
{ id: string; name: string; status: "running" }
```

**Key behaviors:**
- Creates isolated in-process session
- Streams progress via `session.subscribe()`
- Abortable via `halt` tool or `/halt` command
- Inherits parent configuration (system prompt, extensions, skills, themes)
- Filters pi-minions extension to prevent recursive spawning
- Foreground: Parent abort signal connected
- Background: Result auto-delivered via `pi.sendMessage({ deliverAs: "nextTurn" })`

---

### halt

Abort running minion(s).

**Schema:** `{ targets: string[] }`

**Example:** `halt({ targets: ["researcher"] })` or `halt({ targets: ["all"] })`

**Returns:** `{ halted: string[]; notFound: string[] }`

**Behavior:**
- Throws `[HALTED]` error (red banner in UI)
- System prompt instructs LLM: "do NOT retry when [HALTED]"

---

### list_agents

Discover available named agents.

**Returns:**
```typescript
{ agents: Array<{ name: string; description: string; file: string }> }
```

**Discovery paths:** `~/.pi/agent/agents/`, `.pi/agents/`

---

### list_minions

List running and pending minions.

**Returns:**
```typescript
{
  running: Array<{ id, name, task, status: "running", mode: "foreground"|"background", lastActivity }>,
  pending: Array<{ id, name, task, status: "pending", completedAt }>
}
```

---

### show_minion

Detailed status for one minion.

**Schema:** `{ target: string }`

**Returns:**
```typescript
{ id, name, task, status, mode, lastActivity, output: string, usage: {...} }
```

---

### steer_minion

Inject message into running minion.

**Schema:** `{ target: string; message: string }`

**Returns:** `{ id, name, steered: true }`

**Behavior:** Message injected before minion's next LLM call

---

## Commands (User-Initiated)

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
/spawn --model claude-3-7-sonnet-20250219 Review security implications
```

---

### /minions

Manage running minions.

| Subcommand | Syntax | Purpose |
|------------|--------|---------|
| `list` | `/minions` or `/minions list` | Show running/pending |
| `show` | `/minions show <id\|name>` | Detailed view |
| `bg` | `/minions bg <id\|name>` | Send to background (live detach) |
| `steer` | `/minions steer <id\|name> <msg>` | Inject message |

---

### /halt

**Syntax:** `/halt <id|name|all>`

Abort one, multiple, or all running minions.

---

## Types

| Type | Key Fields |
|------|-----------|
| **AgentConfig** | `name, systemPrompt, model?, extensions?` |
| **SpawnResult** | `exitCode, finalOutput, usage: {inputTokens, outputTokens, totalCost}` |
| **AgentNode** | `id, name, task, status, mode, parent?, children[], usage` |
| **QueuedResult** | `id, name, task, output, status, completedAt, usage` |

---

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PI_MINIONS_DEBUG` | Enable debug logging | `0` |
| `PI_MINIONS_TIMEOUT` | Global timeout for all minions (ms). 30s grace period before force abort. | unlimited |

### Safety Configuration

Configure per-agent via frontmatter or globally via environment variables.

| Setting | Frontmatter | Env Var | Behavior |
|---------|-------------|---------|----------|
| **Step limit** | `steps: 30` | — | Graceful steer at limit, force abort after 1 grace turn |
| **Timeout** | `timeout: 60000` | `PI_MINIONS_TIMEOUT` | Graceful steer at expiry, force abort after 30s grace |

Per-agent `timeout` overrides `PI_MINIONS_TIMEOUT`. Step limits are per-agent only.

### Agent Discovery

Named agents discovered from:
1. `~/.pi/agent/agents/` (global)
2. `.pi/agents/` (project-local)

**Agent file format:**
```markdown
---
name: researcher
description: Research with citations
model: claude-3-5-sonnet-20241022
steps: 30
timeout: 60000
---
[System prompt content]
```

---

## Logging

| Log Type | Location | Contents | Enable |
|----------|----------|----------|--------|
| **Debug** | `/tmp/logs/pi-minions/debug.log` | Extension lifecycle, spawn events, errors. `info`/`warn`/`error` always logged; `debug` respects `PI_MINIONS_DEBUG`. | `PI_MINIONS_DEBUG=1` (for debug level) |
| **Transcripts** | `/tmp/logs/pi-minions/minions/<id>-<name>.log` | Per-minion conversation (tool calls, output deltas, messages) | Always on |

---

## Design Notes

### In-Process Sessions
Uses `createAgentSession()` instead of `child_process.spawn()`:
- No process overhead
- Typed streaming via `session.subscribe()`
- Clean abort via `session.abort()`
- Access to `ctx.modelRegistry`

### Configuration Inheritance
Minions inherit parent session configuration:
- System prompts from parent session
- Extensions (except pi-minions, automatically filtered)
- Skills, themes, and prompt templates
- Prevents recursive spawning by filtering pi-minions extension

**Rationale:** Minions have same capabilities as parent (custom tools, skills) while preventing infinite recursion via extension filtering.

### Abort Throws
`halt` throws error (not returns) so pi renders red banner. System prompt reinforces "do NOT retry."

### Background Auto-Delivery
Results auto-delivered via `pi.sendMessage({ deliverAs: "nextTurn" })`. No manual acceptance required.

### Live Detach
Foreground spawn races `runMinionSession()` vs detach promise:
- Normal: session completes → return result
- Detach: disconnect parent signal, wire to queue, return "sent to bg"

Same session continues—no kill/respawn.
