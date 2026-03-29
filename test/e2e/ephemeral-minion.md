# Test: ephemeral-minion

Verify that spawning without an agent name creates an ephemeral minion with default capabilities.

## Setup

```bash
rm -f /tmp/logs/pi-minions/minions/*.log 2>/dev/null
```

## Action

Call the `spawn` tool with:
- `task`: `What is 2 + 2? Reply with just the number.`

Do NOT provide an `agent` parameter.

After the spawn completes, read the minion's transcript file.

## Expected

- The spawn tool completed without error
- The spawned minion's transcript file exists
- The spawned minion's transcript contains the header `=== Minion:`
- The spawned minion's transcript contains `Completed`

## Cleanup

None.
