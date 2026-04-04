# Test: batch-spawn

Verify batch spawn executes multiple minions in parallel under a single render block.

## Setup

None.

## Action

Call the `spawn` tool with a `tasks` array containing 3 minions:
- Task 1: `Return 'alpha'`
- Task 2: `Return 'beta'`
- Task 3: `Return 'gamma'`

## Expected

- The tool returns successfully with results from all 3 minions
- The result text contains `alpha`, `beta`, and `gamma`
- The debug log shows `batch-start` with count=3 and `batch-complete` with succeeded=3

Verify via:
```bash
grep -E "spawn:tool.*(batch-start|batch-complete)" /tmp/logs/pi-minions/debug.log
```

## Cleanup

None.
