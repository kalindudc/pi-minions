# AGENTS

pi-minions is a pi-coding-agent extension (`src/index.ts`) that adds recursive subagent orchestration — many LLM-callable tools and user commands for spawning and managing isolated in-process agent sessions (minions).

## Architecture

| Module | Purpose |
|--------|---------|
| `src/index.ts` | Entry point — registers tools, commands, event listeners |
| `src/tree.ts` | `AgentTree` — minion hierarchy (parent-child, status, usage) |
| `src/queue.ts` | `ResultQueue` — background result delivery |
| `src/spawn.ts` | `runMinionSession()` — in-process session creation, streaming, safety controls |
| `src/minions.ts` | Minion names, ID generation, default prompt |
| `src/agents.ts` | Agent discovery (global + project paths), frontmatter parsing |
| `src/render.ts` | TUI rendering for spawn calls |
| `src/logger.ts` | Structured debug logging |
| `src/types.ts` | Shared types (`AgentConfig`, `AgentNode`, `QueuedResult`, `SpawnResult`) |
| `src/tools/*.ts` | Tool implementations (`spawn`, `spawn_bg`, `halt`, `list_agents`, `list_minions`, `show_minion`, `steer_minion`) |
| `src/commands/*.ts` | Command handlers (`/spawn`, `/minions`, `/halt`) |

## Development

| Command | Purpose |
|---------|---------|
| `task up` | Install deps, verify toolchain |
| `task dev` | Load extension into pi (debug mode) |
| `task test` | Run unit tests (vitest) |
| `task typecheck` | TypeScript type check |
| `task test:e2e` | Run agentic e2e tests |

Conventional commits: `feat:`, `fix:`, `chore:`, `docs:`, etc.

## Key conventions

- TypeScript strict (`tsc --noEmit` must pass)
- vitest for unit tests, agentic markdown tests for e2e
- No JSDoc — types are the documentation
- Flat `docs/` directory, no nesting
- Documentation - each concept lives in exactly one file
- Cross-reference between docs, never duplicate content
- Do NOT mix quadrants in a single doc file

## Testing

Always load `/skill:test-writer` before writing or auditing tests and follow it's guidance

## Documentation

- [Getting started](docs/getting-started.md) — tutorial walkthrough
- [Patterns](docs/patterns.md) — how-to recipes
- [Agents](docs/agents.md) — agent creation and configuration
- [Reference](docs/reference.md) — tool/command schemas and types
- [Architecture](docs/architecture.md) — module map, data flow, design decisions
- [Contributing](docs/contributing.md) — dev setup, testing, release
- [E2E testing](docs/e2e-testing.md) — writing agentic tests

## Do NOT

- Edit generated files or `node_modules/`
- Duplicate content across doc files — link instead
- Mix documentation quadrants (tutorial/how-to/reference/explanation) in a single file
- Reference `tmp/research/` from user-facing docs (internal only)
