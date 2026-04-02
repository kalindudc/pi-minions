# Changelog

## [Unreleased]

## [0.6.0] - 2026-04-01

- feat: file-based subsession foundation with persistent minion sessions — replaces in-process sessions with SubsessionManager-managed file-based sessions; minions now persist with parent references, separate detach/halt signals, and explicit foreground/background tracking
- chore: update roadmap task completion status

## [0.5.2] - 2026-03-31

- fix: memory leak in result queue, logger blocking IO, progress spinner churn, background minion tool call rendering
- feat: add performance testing suite and bottleneck analysis skill
- docs: remove @latest tag recommendation, update roadmap tasks
- chore: re-organize skills and code

## [0.5.1] - 2026-03-30

- fix: /minions now behaves instantaneously when there are no foreground minions
- chore: improve minion status line, move hint from TUI banner to status line

## [0.5.0] - 2026-03-29

- feat: /minions list/show/steer commands now work instantaneously via notifications when parent session is busy, while retaining LLM-routed behavior when idle
- chore: package.json formatting

## [0.4.0] - 2026-03-29

- feat: custom footer showing combined minion + parent session token usage for complete session cost visibility
- fix: minion completion status rendering when parallel foreground minions are active
- fix: `task dev` plugin loading when stable version is already installed
- fix: release script now generates `package-lock.json` before committing
- chore: CHANGELOG.md formatting

## [0.3.0] - 2026-03-29

- feat: extend agent discovery to support `~/.agents/` and `.agents/` paths
- fix: tool prompt guidelines for parallel minion spawning
- docs: documentation overhaul with getting-started tutorial, architecture, contributing, and agents guides
- test: agent discovery unit tests and parallel foreground spawns e2e test
- chore: update minion name pool

## [0.2.0] - 2026-03-29

- feat: safety controls with step count and timeout for minions
- feat: config inheritance from parent sessions
- feat: agentic e2e test suite
- test: comprehensive e2e test coverage
- docs: add roadmap for v1.0.0
- chore: remove unused update-docs prompt
- chore: streamline minion name pool

## [0.1.0] - 2026-03-28

- feat: in-process minion sessions with streaming and clean abort
- feat: background mode with spawn_bg tool and auto-delivery
- feat: /minions command (list, show, bg, steer subcommands)
- feat: live detach - send foreground minions to background without interruption
- feat: steering support - inject messages into running minions mid-execution
- feat: hierarchical agent tree tracking
- feat: result queue for background minions
- feat: transcript logging per minion
- feat: /prompt release workflow for git-based releases
- feat: /prompt update-docs workflow for documentation maintenance
- fix: minion name/ID persistence on error banners
- docs: concise documentation (66% reduction - 1430→492 lines)
- docs: roadmap focused on project direction (82% reduction)
- docs: conventional commit guide
- chore: release automation with scripts/release.sh
- chore: improved minion system prompt with file creation boundaries
