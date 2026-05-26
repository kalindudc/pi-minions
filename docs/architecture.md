# Architecture

pi-minions is a pi extension for foreground subagent orchestration.

## Module map

| Module | Purpose |
|---|---|
| `src/index.ts` | Registers tools, commands, renderer, session hooks, status/footer wiring |
| `src/tools/spawn.ts` | Public foreground `spawn` tool and batch orchestration setup |
| `src/spawn.ts` | Runs one minion session and enforces internal step/timeout safety |
| `src/spawn/batch.ts` | Aggregates foreground minion status, output, usage, and render updates |
| `src/spawn/runner.ts` | Runs a single foreground minion inside a batch coordinator |
| `src/tools/minions.ts` | `list_minions` and `show_minion` text surfaces |
| `src/tools/halt.ts` | Abort path for running minions |
| `src/commands/*.ts` | User slash commands |
| `src/subsessions/manager.ts` | File-based minion session lifecycle, metadata, progress events |
| `src/subsessions/event-bus.ts` | Lightweight event bus for progress and completion events |
| `src/subsessions/observability.ts` | Live activity widget for foreground minions |
| `src/status.ts` | Foreground minion status line and hints |
| `src/tree.ts` | In-memory minion hierarchy, status, usage, and activity |
| `src/skill.ts` | Packaged usage guidance returned by learn surfaces |

## Data flow

1. Parent calls `spawn` or `/spawn` directs the parent to call it.
2. `src/tools/spawn.ts` validates single versus batch params, resolves named or ephemeral agent config, creates tree nodes, and starts a `BatchCoordinator`.
3. Each minion is run through `runSingleMinion()` and `runMinionSession()`.
4. `SubsessionManager` creates a file-backed pi agent session, filters recursive extension loading, binds extensions, tracks metadata, and emits progress events.
5. Progress callbacks update `AgentTree`; renderers/status/observability read from that tree.
6. The foreground tool call returns final output and usage when all minions finish, fail, or are halted.

## Foreground visibility

Foreground visibility is intentionally retained after slimming the package:

- `AgentTree` stores running and completed minion state for the current parent session.
- `list_minions` summarizes tree state.
- `show_minion` formats detailed status, usage, and recent activity.
- `/minions` opens a live widget for running minions.
- `EventBus` carries progress/completion events from subsessions to the observability widget.
- `status.ts` shows active foreground minion count and lightweight hints.

## Safety controls

User-facing steering is not public. Internal safety steering remains inside `src/spawn.ts` so step limits and timeouts can ask a minion to wrap up before force-aborting.

## Packaging

The published npm tarball includes source plus npm always-included metadata files. User-facing docs live in the repository and are intentionally omitted from the package tarball.
