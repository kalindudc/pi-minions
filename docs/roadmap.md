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
- [ ] minion recursion with depth limits (agent frontmatter config)
- [ ] minion chaining (output of one feeds into another)
- [ ] bug: foreground minions cannot be parallelized, even if that is the intent of the LLM

### observability
- [x] simple widget to see background minion count
- [x] streamable tool call output from minion sessions
- [x] transcript logging per minion (tmp/logs/minions/)
- [x] activity tracking with live progress updates
- [x] detailed minion status (show_minion tool)
- [x] list running and pending minions (list_minions tool)
- [x] standardize debug logging
- [ ] TUI dashboard to view full conversation and activity with keyboard hotkeys
- [ ] minion history/audit trail across sessions
- [ ] visual minion tree/hierarchy display
- [ ] export minion transcripts and results to files
- [ ] performance metrics and analytics dashboard

### config and support
- [x] step/turn count limits per minion
- [x] timeout configuration per minion or globally
- [ ] bring background minions to foreground with queue
- [ ] configurable defaults for the extension (via pi config)
- [ ] cost budgeting per minion with warnings/auto-halt
- [ ] resource limits (token limits, time limits, turn limits)
- [ ] priority queue for background minions
- [ ] batch spawn operations (spawn multiple related tasks)

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

### v1 and beyond
- [ ] integration with external tools/APIs
- [ ] collaborative minions (shared state, coordination)
- [ ] distributed minions (across machines/containers)
- [ ] self improving flow, minions should provide feedback outside the immediate task loop
