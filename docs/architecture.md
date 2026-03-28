# Architecture

## Overview

pi-minions is a pi extension that adds autonomous subagent spawning. The parent agent delegates tasks to minions that run in isolated in-process sessions with their own tools and system prompt.

```
Parent pi session
  └─ spawn tool (LLM-initiated) or /spawn command (user-initiated)
       └─ createAgentSession() — in-process, isolated context
            └─ session.prompt(task) — runs full agent loop
                 └─ built-in tools: read, bash, edit, write, grep, find, ls
```

## Key Components

### `src/spawn.ts` — Session runner

`runMinionSession(config, task, opts)` — creates and runs an in-process agent session.

- Uses pi SDK: `createAgentSession`, `DefaultResourceLoader`, `SessionManager.inMemory()`
- `noExtensions: true` — minions get built-in tools only (no spawn/halt/MCP). Prevents infinite nesting.
- `systemPromptOverride` — injects minion system prompt without temp files
- Subscribes to `session.subscribe()` for streaming events (tool activity, text deltas, turn boundaries)
- Writes transcript to `tmp/logs/minions/<id>-<name>.log`
- Returns `SpawnResult { exitCode, finalOutput, usage }`

### `src/minions.ts` — Template factory

`defaultMinionTemplate(name, overrides?)` — creates ephemeral `AgentConfig` with `DEFAULT_MINION_PROMPT`.

The prompt establishes: isolation context, fail-fast rules (STOP on failure, no fabrication, no silent retry), structured output format (Result/Files/Notes).

### `src/tools/spawn.ts` — Spawn tool

`makeSpawnExecute(tree, handles)` — LLM-callable tool for task delegation.

- `agent` param is optional. Omitted = ephemeral minion via `defaultMinionTemplate`. Provided = discovered from `~/.pi/agent/agents/` or `.pi/agents/`.
- Tracks minions in `AgentTree` for status/usage
- Stores `AbortController` in `handles` map for `/halt` support
- Streams progress via `onUpdate` callback → `renderResult` with `isPartial`
- Sets `ctx.ui.setWorkingMessage()` for status bar updates during execution

### `src/tools/halt.ts` — Halt tool

`abortAgents(ids, tree, handles)` — calls `controller.abort()` which triggers `session.abort()`.

Halt resolves targets by ID or minion name via `tree.resolve()`. Aborted minions throw `[HALTED]` from the spawn tool so pi marks `isError: true` (red banner). The error message instructs the LLM not to retry.

### `src/tools/list-agents.ts` — Agent discovery tool

`makeListAgentsExecute()` — returns the built-in ephemeral minion + all discovered named agents. The LLM calls this to discover what agents are available before spawning by name.

### `src/commands/spawn.ts` — /spawn command

Parses args → dispatches foreground or background spawn.

- **Foreground** (default): `pi.sendUserMessage(directive)` → LLM calls spawn tool. The result lands in conversation context, `/halt` works, and messages queue normally. During execution, the minion banner shows `/minions bg <name>` hint for sending to background.
- **Background** (`--bg`): `spawnInBackground()` → fires off `runMinionSession()` in detached async, registers in tree/handles, queues `QueuedResult` on completion, and auto-delivers the result to the parent LLM via `pi.sendMessage({ deliverAs: "nextTurn" })`.

### `src/queue.ts` — Result queue

`ResultQueue` — holds completed background minion results.

- Results enter as `"pending"` and transition to `"accepted"`, `"evaluated"`, or `"dismissed"`
- `onChange(listener)` drives the background widget refresh
- `clear()` removes non-pending entries (called on `before_agent_start`)
- Background spawns auto-accept results after delivery, so `/minions accept` won't duplicate

### `src/commands/minions.ts` — /minions command

Queue management for background minion results:

- `/minions` or `/minions list` — shows running minions (from tree) and pending results (from queue). Labels each running minion as `[fg]` or `[bg]`.
- `/minions bg <id|name>` — sends a running foreground minion to the background without interrupting it. The parent conversation unlocks immediately. The minion continues running and queues its result on completion.
- `/minions steer <id|name> <message>` — sends a steering message to a running minion's session via `session.steer()`. The message is injected into the minion's context before its next LLM call. Works for both foreground and background minions.
- `/minions show <id|name>` — detailed view of a minion's status, usage, and output preview. Uses `tree.resolve()` for name lookup.

Background minions auto-deliver results to the parent LLM via `pi.sendMessage({ customType: "minion-result", deliverAs: "nextTurn" })`. No manual accept/eval/dismiss needed.

### `src/render.ts` — TUI rendering

- `renderCall` — shows agent name (named) or task preview (ephemeral)
- `renderResult` — during streaming (`isPartial`): animated braille spinner + live activity (tool output, text deltas). On completion: ✓ green (success), ✗ red (error/abort) + usage stats.
- `isError` is read from `ctx.isError` (ToolRenderContext), not from the result object.
- `minion-result` message renderer — registered in `index.ts` for displaying auto-delivered background results in the conversation. Shows `▸ minion result` header with expandable output.

### `src/tree.ts` — Agent tree

Tracks minion hierarchy, status transitions, and usage aggregation. Supports nested spawning.

### Background widget (`index.ts`)

A `setWidget("minions-bg", lines)` widget above the editor, driven by `queue.onChange()`:
- Shows `⟳ name — task` for running background minions (from tree)
- Shows `● name — task` for pending results (from queue)
- Shows `/minions to review` hint when pending results exist
- Cleared automatically when no running/pending items remain

### Detach mechanism (foreground → background)

The spawn tool supports live detaching via `/minions bg`. When a foreground minion starts, the tool registers a `DetachHandle` (a `{ resolve }` callback) in a shared `detachHandles` map keyed by minion ID. The tool then races `runMinionSession()` against the detach promise:

- **Normal path**: session completes first → tool returns the result as usual
- **Detach path**: `/minions bg` resolves the detach promise → tool disconnects the parent abort signal (so aborting the parent won't kill the minion), wires session completion to the queue, and returns immediately with a "sent to background" message. The parent conversation unlocks.

This avoids killing and re-spawning — the minion continues running its existing session uninterrupted.

## Data Flow

### Foreground (default)

```
/spawn <task>
  → parseSpawnArgs → { task, model?, background: false }
  → pi.sendUserMessage("Use the spawn tool to delegate...")
  → LLM calls spawn tool
  → makeSpawnExecute:
      → defaultMinionTemplate(name) or discoverAgents()
      → tree.add(id, name, task)
      → handles.set(id, AbortController), detachHandles.set(id, DetachHandle)
      → race: runMinionSession vs detachPromise
          → session completes → tree.updateStatus, tree.updateUsage → return result
          → detach resolves → disconnect parent signal, wire to queue, return "sent to bg"
```

### Background (`--bg`)

```
/spawn --bg <task>
  → parseSpawnArgs → { task, model?, background: true }
  → spawnInBackground:
      → tree.add(id, name, task), handles.set(id, AbortController)
      → ctx.ui.notify("Spawned name (id) in background")
      → (async, fire-and-forget):
          → runMinionSession(config, task, { signal, modelRegistry, parentModel, cwd })
          → tree.updateStatus, tree.updateUsage
          → queue.add({ id, name, task, output, status: "pending", ... })
          → pi.sendMessage({ customType: "minion-result", deliverAs: "nextTurn" })
          → queue.accept(id)
          → ctx.ui.notify("name completed — result queued for parent.")
          → refreshBgWidget() (via queue.onChange)
```

## Technical Decisions

### In-process sessions over child processes

Previous: `child_process.spawn("pi", ["--mode", "json", ...])` — parsed JSON stdout, temp files for system prompt, SIGTERM/SIGKILL for abort.

Current: `createAgentSession()` + `session.prompt()` from pi SDK. Advantages:
- No process startup overhead
- Streaming via `session.subscribe()` (typed events, not stdout parsing)
- Clean abort via `session.abort()` (not process signals)
- Access to `ctx.modelRegistry` (not CLI `--model` strings)
- System prompt via `systemPromptOverride` (not temp files)
- Future: `session.steer()` for mid-run interaction, resume via re-prompt

Trade-off: shared process memory (less isolation). Acceptable for coding agents.

### noExtensions: true for minions

Minions run with `noExtensions: true` on the `DefaultResourceLoader`. This means:
- No access to spawn/halt tools (prevents recursive spawning)
- No MCP servers or other extensions
- Only built-in tools via `createCodingTools(cwd)`

This replaces the previous `PI_MINIONS_DEPTH` env var approach. Simpler and more robust.

### sendUserMessage for /spawn

The `/spawn` command uses `pi.sendUserMessage()` to trigger the LLM, which then calls the spawn tool. This adds a small LLM inference delay but ensures:
- Result appears as a proper tool call in conversation
- `/halt` works (tool blocks the parent turn)
- Message queueing works (user can type during execution)

There is no `callTool()` API on `ExtensionAPI` to bypass the LLM. pi-subagents (tintinweb/pi-subagents) also uses this pattern.

### Abort throws (not returns)

When a minion is halted, the spawn tool throws `[HALTED] ... do NOT retry`. This ensures:
- pi sets `isError: true` → red banner/border in TUI
- The error message content tells the LLM not to retry
- A system prompt guideline reinforces: "When a spawn result says [HALTED], do NOT retry"

Returning normally (non-error) was tried first but pi rendered it as green/success, confusing users.

## Logging

- **Debug log**: `tmp/logs/debug.log` — enabled via `PI_MINIONS_DEBUG=1`. Extension lifecycle, spawn start/complete, errors.
- **Transcripts**: `tmp/logs/minions/<id>-<name>.log` — per-minion conversation log. Tool calls with args, tool output (deltas only), assistant messages, turn boundaries.
