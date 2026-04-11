## Road to v1.0.0

### core
- [x] spawnable minions with tool call and command
- [x] halt minions on demand with command and tool for parent sessions
- [x] support subagent definition for configuring minions
- [x] configuration inheritance (system prompt, extensions, skills, themes)
- [x] support for background minions (spawn_bg tool)
- [x] send foreground minions to background without interruption (/minions bg)
- [x] steer minions with additional tasks/prompts (foreground and background)
- [x] tools for minion/agent discovery (list_agents tool)
- [x] bug: foreground minions cannot be parallelized, even if that is the intent of the LLM
- [x] add support for the `latest` tag when making releases
- [x] performance and benchmark tests for the extension
- [x] optimize logger: replace appendFileSync with async batching at src/logger.ts:14
- [x] fix memory leak: prune delivered results from ResultQueue at src/queue.ts:4
- [x] reduce spinner overhead: increase interval from 80ms to 200ms at src/tools/spawn.ts:196
- [x] add `task style` command with Biome linter/formatter (enforces clean codebase with zero warnings)
- [x] delegation reminder is very in consistent and there is no feedback when it is received
- [x] add `/minions version` command to quickly see the running extension version
- [x] bug: do not send a user message for background minion result, the LLM thinks it is from the user and evaluates as a user message which can lead to confusion
- [x] forward interactive extension calls (confirm, select, input, editor) from minion sessions to parent UI via EventBus proxy
- [x] bug: when the parent uses the halt tool, the aborted minion still sends back a user message, this is wasteful
- [ ] minion recursion with depth limits (agent frontmatter config)
- [ ] minion chaining (output of one feeds into another)
- [ ] bring background minions to foreground with queue
- [ ] fix critical unbounded Map growth: add TTL/capacity limit to ResultQueue results at src/queue.ts:10

### observability
- [x] simple widget to see background minion count
- [x] streamable tool call output from minion sessions
- [x] transcript logging per minion (tmp/logs/minions/)
- [x] activity tracking with live progress updates
- [x] detailed minion status (show_minion tool)
- [x] list running and pending minions (list_minion_types tool)
- [x] standardize debug logging
- [x] bug: when multiple parallel minions are working in the foreground and when one finishes before the other, it's completion status does not update until one of the other completes (rendering bug in TUI)
- [x] minions spawned in a session should count towards the parent sessions token usage and cost to be visible on the footer widget
- [x] /minions commands should work instantaneously so that they can influence foreground minions and display information about foreground minions when the parent sessions is blocked
- [x] the background minion count widget can use our existing custom footer widget
- [x] replace the background hint on foreground minions in the TUI from the banner to the footer similar to the background minion count
- [x] add token usage to the foreground minion banner
- [x] token usage is not shows on a foreground minion banner until it has completed because it is not available or updated while the minion is running
- [x] minion token usage to cost is not available
- [x] [critical bug]: scrollback/viewport lock with parallel foreground minions that renders beyond the viewport — TUI full re-render storm
- [x] add custom agent names next to the minion names if relevant, with support for a color/colour field in frontmatter
- [x] TUI dashboard to view full conversation and activity with keyboard hotkeys
- [ ] add more commands to the minion view, s (steer), (b) move to background, (f) move to foreground
- [ ] minion history/audit trail across sessions
- [ ] visual minion tree/hierarchy display
- [ ] export minion transcripts and results to files
- [ ] performance metrics and analytics dashboard
- [ ] persistent steer history widget in TUI (notify toasts are transient, multiple steers lose history)

### config and support
- [x] step/turn count limits per minion
- [x] timeout configuration per minion or globally
- [x] batch spawn operations (spawn multiple related tasks)
- [x] configurable defaults for the extension (via pi config)
- [ ] cost budgeting per minion with warnings/auto-halt
- [ ] resource limits (token limits, time limits, turn limits)
- [ ] priority queue for background minions

### quality control
- [x] improve default prompt of generic minions to limit verbosity
- [ ] error recovery with retry mechanisms (user confirmation)
- [ ] better error messages with actionable suggestions
- [ ] automatic delegation instructions for parent sessions
- [ ] minion templates/presets for common tasks
- [ ] more variety of built-in minions with hints for delegation
- [ ] conflict detection when minions work on same files
- [ ] validation gates before destructive operations
- [ ] interactive debugging mode for stuck minions

### nice to have (v1.x.x)
- [ ] minion output filtering/search capabilities
- [ ] minion result comparison tools
- [ ] notification system for minion completion (desktop/sound)
- [ ] advanced UX and deeper TUI integration for better interactivity
- [ ] minion snapshots/checkpoints for long-running tasks
- [ ] minion scheduling (run at specific times)
- [ ] parallelize e2e tests to make them faster to run
- [ ] consider createAgentSessionServices() for unified diagnostics

### v1.0.0 and beyond
- [ ] integration with external tools/APIs
- [ ] collaborative minions (shared state, coordination)
- [ ] distributed minions (across machines/containers)
- [ ] self improving flow, minions should provide feedback outside the immediate task loop
