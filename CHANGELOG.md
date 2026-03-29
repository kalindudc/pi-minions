# Changelog

## [Unreleased]

## [0.2.0] - 2026-03-29

feat: safety controls with step count and timeout for minions
feat: config inheritance from parent sessions
feat: agentic e2e test suite
test: comprehensive e2e test coverage
docs: add roadmap for v1.0.0
chore: remove unused update-docs prompt
chore: streamline minion name pool

## [0.1.0] - 2026-03-28

feat: in-process minion sessions with streaming and clean abort
feat: background mode with spawn_bg tool and auto-delivery
feat: /minions command (list, show, bg, steer subcommands)
feat: live detach - send foreground minions to background without interruption
feat: steering support - inject messages into running minions mid-execution
feat: hierarchical agent tree tracking
feat: result queue for background minions
feat: transcript logging per minion
feat: /prompt release workflow for git-based releases
feat: /prompt update-docs workflow for documentation maintenance
fix: minion name/ID persistence on error banners
docs: concise documentation (66% reduction - 1430→492 lines)
docs: roadmap focused on project direction (82% reduction)
docs: conventional commit guide
chore: release automation with scripts/release.sh
chore: improved minion system prompt with file creation boundaries
