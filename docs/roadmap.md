# pi-minions Roadmap

## Completed: v0.2 — Thin Wrapper + In-Process Sessions

Plan: `tmp/plan/minion-flow/01-rewrite-spawn-command.md`

- [x] `defaultMinionTemplate(name, overrides?)` factory with fail-fast system prompt
- [x] Spawn tool supports optional `agent` param (ephemeral fallback)
- [x] `/spawn` rewritten to thin `sendUserMessage` wrapper (200 → ~50 lines)
- [x] Dead code removed: widgets, fire-and-forget async, message renderer
- [x] **In-process sessions** via `createAgentSession` + `session.prompt()` (replaced child-process spawning)
- [x] Streaming progress to parent via `onUpdate` + `setWorkingMessage`
- [x] Abort via `AbortController` → `session.abort()` (replaced SIGTERM/SIGKILL)
- [x] Minion transcript logging to `tmp/logs/minions/<id>-<name>.log`
- [x] No more: temp files, JSON stdout parsing, `PI_MINIONS_DEPTH` env var, `child_process`

## Completed: v0.3 — Background Mode and Queue Management

Plan: `tmp/plan/minion-flow/02-background-queue-and-mgmt.md`

- [x] `--bg` flag on `/spawn` for background fire-and-forget
- [x] `QueuedResult` type and `ResultQueue` class
- [x] `/minions` command (`list`, `show`, `bg`, `steer`)
- [x] Background status widget above editor
- [x] `minion-result` message renderer for `/minions accept`
- [x] Auto-delivery of background results to parent LLM via `pi.sendMessage({ deliverAs: "nextTurn" })`
- [x] `/minions bg <id|name>` — live detach: send a running foreground minion to background without interrupting it
- [x] `/minions steer <id|name> <message>` — send steering messages to running minions
- [x] Streaming banner shows `/minions bg <name>` hint during foreground execution
- [x] Render state caching preserves minion name/ID on error/abort banners

## Planned: v0.4 — Observability Dashboard

Plan: `tmp/plan/minion-flow/03-observability-dashboard.md`

- [ ] `MinionActivityStore` — per-minion event streams
- [ ] Interactive `/minions` dashboard via `ctx.ui.custom()`
- [ ] Live activity viewer for running minions
- [ ] `Ctrl+Alt+M` shortcut

## Future: v0.5+

- Built-in agent templates (researcher, scout, reviewer, planner)
- Parallel spawning with concurrency limits
- Chain workflows (sequential agents with `{previous}` placeholder)
- Session persistence via `pi.appendEntry()`
- Cost controls and budgets
- Steering running minions via `session.steer()`
- Resume previous minion sessions
- Nested spawning with tree visualization
