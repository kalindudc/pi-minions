# Test: list-minions

Verify that the `list_minions` tool shows running minions.

## Setup

```bash
rm -f /tmp/logs/pi-minions/minions/*.log 2>/dev/null
```

## Action

First, call the `spawn_bg` tool with:
- `agent`: `e2e-slow`
- `task`: `Read every file in the src/ directory one by one. For each file provide a detailed 1000 word analysis.`

Extract the minion name from the spawn_bg response.

Wait 2 seconds, then call the `list_minions` tool.

After checking, call the `halt` tool with:
- `id`: `all`

## Expected

- The `list_minions` result contains the word "Running"
- The `list_minions` result contains the minion name from the spawn_bg response

## Cleanup

None.
