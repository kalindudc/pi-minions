# pi-minions

`pi-minions` is a lightweight pi extension for foreground subagent delegation. It lets a parent agent spawn isolated minion sessions, stream progress, inspect live activity, and halt running minions when needed.

## Features

- Foreground `spawn` tool for single minion delegation
- Batch foreground `spawn` via a `tasks` array for parallel independent work
- Named agent discovery from pi/agents and minions directories
- Ephemeral built-in minions when no agent is specified
- `halt` for aborting running foreground minions
- `list_minions` and `show_minion` for current session visibility
- `/minions` and `/minions show <id|name>` for live activity viewing
- `learn_minions`, `/minions learn`, and `/minions skill` for built-in usage guidance

Background minions, live detaching, and user steering commands are not part of the public surface.

## Quick start

```text
/spawn Summarize the test failures in this repository
/spawn Inspect src/tools and report risks --model claude-haiku
/minions
/minions show kevin
/minions learn
/halt kevin
```

For LLM-callable tools, use:

```ts
spawn({ task: "Audit the auth module" })
spawn({ tasks: [{ task: "Read src" }, { task: "Read test" }] })
list_agents({})
list_minions({})
show_minion({ target: "kevin" })
halt({ id: "all" })
learn_minions({})
```

## Configuration

```json
{
  "pi-minions": {
    "minionNames": ["kevin", "stuart", "bob"],
    "allowEphemeral": true,
    "display": {
      "outputPreviewLines": 20,
      "observabilityLines": 6,
      "showStatusHints": true,
      "spinnerFrames": ["[oo]", "[o-]", "[--]", "[-o]"]
    },
    "toolSync": {
      "enabled": true,
      "maxWait": 5
    }
  }
}
```

## Documentation

- [Getting started](docs/getting-started.md)
- [Patterns](docs/patterns.md)
- [Agents](docs/agents.md)
- [Reference](docs/reference.md)
- [Architecture](docs/architecture.md)
- [Configuration](docs/configuration.md)
- [E2E testing](docs/e2e-testing.md)
- [Contributing](docs/contributing.md)

The npm package ships source plus standard npm always-included files. The `docs/` directory and changelog file are intentionally not included in the published tarball.
