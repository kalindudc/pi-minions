# Changelog

## [0.3.0] - 2026-03-27

### Added

- `spawn_bg` tool for background minion execution (fire-and-forget, auto-delivers results)
- `/spawn --bg` flag to spawn minions in background via the `spawn_bg` tool
- `/minions` command with `list`, `show`, `bg`, and `steer` subcommands
- `/minions bg` live detach — send a foreground minion to background without interrupting it
- `list_minions`, `show_minion`, `steer_minion` tools for parent LLM visibility
- `ResultQueue` for tracking background minion results
- Footer status showing background minion count
- Live activity tracking on `AgentNode.lastActivity`
- `AgentTree.onChange` callback for event-driven UI updates
- Session steer support via `MinionSession` interface
- Render state caching to preserve minion name/ID on error banners

### Changed

- Spawn tool split into `spawn` (foreground) and `spawn_bg` (background)
- `/spawn` remains a thin `sendUserMessage` wrapper per architecture
- Removed `setWorkingMessage` overrides from spawn tool — default pi progress bar is preserved

### Known Issues

- `/minions` commands don't appear as queued messages in TUI when agent is busy (pi API limitation)

## [0.2.0] - 2026-03-26

### Added

- In-process sessions via `createAgentSession` + `session.prompt()`
- `defaultMinionTemplate` factory with fail-fast system prompt
- Streaming progress via `onUpdate` + `setWorkingMessage`
- Abort via `AbortController` → `session.abort()`
- Transcript logging to `tmp/logs/minions/`
- `list_agents` tool for agent discovery

### Removed

- Child process spawning, temp files, JSON stdout parsing, `PI_MINIONS_DEPTH` env var

## [0.1.0] - 2026-03-25

### Added

- Initial spawn tool with child process execution
- `/spawn` and `/halt` commands
- Agent discovery from `~/.pi/agent/agents/` and `.pi/agents/`
