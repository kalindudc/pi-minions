# Test: steer-minion

Verify that the `steer_minion` tool injects a message into a running minion.

## Setup

None.

## Action

First, call the `spawn_bg` tool with:
- `agent`: `e2e-slow`
- `task`: `Read every file in the src/ directory one by one. For each file provide a detailed 1000 word analysis.`

Extract the minion name and ID from the spawn_bg response.

Wait 3 seconds, then call the `steer_minion` tool with:
- `target`: the minion name or ID from above
- `message`: `Finish up now and summarize what you have found so far.`

Wait for the minion to complete (poll debug log for `bg-completed` with the minion ID, max 60 seconds):
```bash
for i in $(seq 1 60); do
  if grep -q '<MINION_ID>.*bg-completed' /tmp/logs/pi-minions/debug.log 2>/dev/null; then
    break
  fi
  sleep 1
done
```
Replace `<MINION_ID>` with the actual ID.

Then read the minion's transcript file.

## Expected

- The `steer_minion` tool returned a message containing "Steered"
- The minion's transcript file exists
- The minion's transcript contains `Completed` (the minion finished after being steered)

## Cleanup

None.
