# Test: extension-loading

Verify the pi-minions extension loaded and registered its tools.

## Setup

```bash
rm -f /tmp/logs/pi-minions/e2e-results.json
rm -f /tmp/logs/pi-minions/minions/*.log 2>/dev/null
```

## Action

Call the `list_agents` tool.

## Expected

- The `list_agents` tool call completes without error

## Cleanup

None.
