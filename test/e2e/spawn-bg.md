# Test: spawn-bg

Verify that `spawn_bg` returns immediately and the minion completes in the background.

## Setup

None.

## Action

Call the `spawn_bg` tool with:
- `task`: `Say hello in one sentence.`

The tool should return immediately with a message like "Spawned <name> (<id>) in background."

Extract the minion name and ID from the response, then wait for the minion to complete:
```bash
# Poll for completion (max 60 seconds)
for i in $(seq 1 60); do
  if grep -q '<MINION_ID>.*bg-completed' /tmp/logs/pi-minions/debug.log 2>/dev/null; then
    break
  fi
  sleep 1
done
```
Replace `<MINION_ID>` with the actual ID.

## Expected

- The `spawn_bg` tool returned immediately with a message containing "in background"
- The debug log contains a line with the minion ID and `bg-completed`
- The transcript file exists at `/tmp/logs/pi-minions/minions/<id>-<name>.log`

## Cleanup

None.
