# E2E testing

> See also: [Contributing](contributing.md) · [Architecture](architecture.md)

## Quick start

```bash
task test:e2e                # run all e2e tests
task test:e2e -- halt        # run filtered (substring match on filename)
```

Results: `/tmp/logs/pi-minions/e2e-results.json`

## Overview

Agentic test suite — a real LLM inside pi executes test markdown files mechanically. Tests the full stack: extension loading → tool registration → session creation → LLM interaction → transcript logging → safety controls.

- Run all: `task test:e2e`
- Run filtered: `task test:e2e -- <filter>` (substring match on filename)
- Results: `/tmp/logs/pi-minions/e2e-results.json`
- Debug log: `/tmp/logs/pi-minions/debug.log`
- Transcripts: `/tmp/logs/pi-minions/minions/<id>-<name>.log`

## How It Works

`task test:e2e` → `scripts/e2e.sh` → `pi -e ./src/index.ts --no-session -p "..."` (background)

1. pi loads the `e2e-runner` skill (`.pi/skills/e2e-runner/SKILL.md`)
2. The skill discovers and executes all `test/e2e/*.md` files in sorted order
3. Progress is written to `/tmp/logs/pi-minions/e2e-progress.log` — the shell script tails it with a spinner
4. After all tests, the skill writes a JSON report; the shell script validates and prints pass/fail

## Writing Tests

Create `test/e2e/<test-name>.md`:

```markdown
# Test: <test-name>

Brief description.

## Setup

\`\`\`bash
# commands to run before the test, or write "None."
\`\`\`

## Action

Describe the tool call(s) to make and any post-action steps.

## Expected

- Condition 1 (PASS/FAIL)
- Condition 2 (PASS/FAIL)

## Cleanup

None.
```

- Tests are independent — no ordering dependencies
- The `# Test:` header must match the filename (without `.md`)
- Use `None.` for empty Setup/Cleanup sections
- See existing tests in `test/e2e/` for reference

## Patterns

- **Spawn tracking**: After `spawn`/`spawn_bg`, extract minion name + ID from the result header. Transcript is at `/tmp/logs/pi-minions/minions/<id>-<name>.log`. Always reference by specific ID, never wildcard.
- **Testing tools that need a running minion**: `spawn_bg` with `e2e-slow` agent → `sleep 2-3` → call tool under test → `halt` all
- **Transcript markers** (deterministic): `=== Minion:`, `--- turn N ---`, `[tool:start]`, `[tool:end]`, `=== Completed (N turns) ===`, `=== Step limit reached ===`, `=== Aborted ===`
- **Debug log format**: `[HH:MM:SS.mmm] [LEVEL] [scope] message {json}` — scope grep by minion ID
- **Error tests**: Describe expected failure in Action; the runner records the error for validation
- **Non-determinism**: Assert structural markers, not LLM-generated text

## Test Agents

| Agent | Config | Purpose |
|-------|--------|---------|
| `e2e-step-limit` | `steps: 2` | Step limit enforcement |
| `e2e-timeout` | `timeout: 15000` | Timeout enforcement |
| `e2e-slow` | `steps: 20` | Long-running agent for concurrent op tests |

Convention: `.pi/agents/e2e-<purpose>.md`, minimal frontmatter, simple system prompt.

## Coverage Map

| Test | Tools Covered | Behavior Verified |
|------|--------------|-------------------|
| `extension-loading` | `list_agents` | Extension loads, tools registered |
| `logging` | `spawn` | Structured debug log entries |
| `step-graceful` | `spawn` | Step limit + graceful completion |
| `step-limit` | `spawn` | Step limit enforcement, turn cap |
| `timeout` | `spawn` | Timeout enforcement |
| `transcripts` | `spawn` | Transcript file structure |
| `spawn-bg` | `spawn_bg` | Background spawn, immediate return, async completion |
| `halt-minion` | `spawn_bg`, `halt` | Abort running minion |
| `list-minions` | `spawn_bg`, `list_minion_types`, `halt` | List running minions |
| `show-minion` | `spawn_bg`, `show_minion`, `halt` | Detailed minion status |
| `steer-minion` | `spawn_bg`, `steer_minion` | Inject message, minion completes |
| `ephemeral-minion` | `spawn` | Spawn without agent, default config |
| `agent-not-found` | `spawn` | Error on invalid agent name |
| `config-inheritance` | `spawn` | Minion inherits tools from parent |
| `recursion-prevention` | `spawn` | Minion cannot re-spawn (no pi-minions extension) |
