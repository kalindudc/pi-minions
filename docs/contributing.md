# Contributing

## Setup

```bash
npm install
```

## Development commands

| Command | Purpose |
|---|---|
| `npm run dev` | Load the extension into pi in debug mode |
| `npm test` | Run unit tests |
| `npm run test:json` | Run unit tests with JSON output |
| `npm run typecheck` | Run TypeScript type checking |
| `npm run style:check` | Check formatting/lint style |
| `npm run test:e2e` | Run agentic e2e specs |

Use `pnpm` equivalents when working in this repository if the local environment is configured for pnpm.

## Project structure

```text
src/
  index.ts              # extension registration
  tools/                # LLM-callable tools
  commands/             # slash commands
  spawn.ts              # minion session orchestration
  spawn/                # batch and single-run helpers
  subsessions/          # file-based minion session lifecycle and observability
  renderers/            # spawn renderer
  status.ts             # status line hints
  tree.ts               # minion state tree
  skill.ts              # built-in learn/skill text

test/
  commands/ tools/ spawn/ subsessions/ ux/ e2e/
```

## Standards

- TypeScript strict mode must pass.
- Tests should verify observable behavior rather than implementation details.
- Prefer simple vertical changes over broad abstractions.
- Do not add runtime dependencies without a clear need.
- User-facing docs live in `docs/`; the npm tarball intentionally excludes repository docs.

## Validation before review

```bash
pnpm --silent test:json
pnpm run typecheck
pnpm run style:check
pnpm pack --dry-run
```

Confirm the package dry run does not include repository docs or the changelog file.
