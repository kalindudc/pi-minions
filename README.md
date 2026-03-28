# pi-minions

Minimal recursive subagent orchestration for pi.

## Install

```bash
pi install https://github.com/kalindudc/pi-minions
```

## Quick Start

```bash
# Foreground (blocks until complete)
/spawn Analyze error logs and identify root cause

# Background (returns immediately)
/spawn --bg Run full test suite and report failures

# Named agent
/spawn --agent researcher Research TypeScript 5.7 features

# Manage minions
/minions list
/minions show researcher
/minions bg slow-task
/halt researcher
```

## Core Concepts

| Concept | Description |
|---------|-------------|
| **Minion** | Isolated pi session, built-in tools only, no extensions |
| **Foreground** | Blocks parent, returns result immediately |
| **Background** | Non-blocking, auto-queues result |
| **Agents** | Named (`~/.pi/agent/agents/`) or ephemeral (default) |

## Commands & Tools

### Commands (User)

| Command | Purpose |
|---------|---------|
| `/spawn [--bg] [--agent NAME] [--model MODEL] <task>` | Spawn minion |
| `/minions [list\|show\|bg\|steer]` | Manage minions |
| `/halt <id\|name\|all>` | Abort minion(s) |

### Tools (LLM)

| Tool | Purpose |
|------|---------|
| `spawn` | Foreground delegation |
| `spawn_bg` | Background delegation |
| `halt` | Abort minion(s) |
| `list_agents` | Discover named agents |
| `list_minions` | List running/pending |
| `show_minion` | Detailed status |
| `steer_minion` | Inject message mid-execution |

## Common Patterns

**Parallel research:**
```bash
/spawn --bg Research React 19 server components
/spawn --bg Research Next.js 15 migration
/spawn --bg Research Vercel best practices
```

**Live detach:**
```bash
/spawn Analyze codebase
# Takes too long...
/minions bg analyzer
```

**Steering:**
```bash
/spawn --bg Run tests
/minions steer tester "Focus only on integration tests"
```

See [docs/patterns.md](docs/patterns.md) for more.

## Configuration

`PI_MINIONS_DEBUG=1` enables debug logging.

**Logs:** `tmp/logs/debug.log`, `tmp/logs/minions/<id>-<name>.log`

## Documentation

- [Reference](docs/reference.md) - Complete API docs
- [Patterns](docs/patterns.md) - Usage patterns
- [Roadmap](docs/roadmap.md) - Planned features
- [Changelog](CHANGELOG.md) - Version history

## Development

```bash
npm install && npm test
```

**Releases:** Conventional commits (`feat:`, `fix:`, etc.) → `/prompt release` → `./scripts/release.sh`

## License

MIT - see [LICENSE.md](LICENSE.md)
