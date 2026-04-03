# Test: halt-minion

Verify that the `halt` tool stops a running background minion.

## Setup

None.

## Action

First, call the `spawn_bg` tool with:
- `agent`: `e2e-slow`
- `task`: `Read every file in the src/ directory one by one. For each file provide a detailed 1000 word analysis.`

Extract the minion name and ID from the spawn_bg response.

Wait 3 seconds for the minion to start running:
```bash
sleep 3
```

Then call the `halt` tool with:
- `id`: the minion ID or name from above

## Expected

- The `spawn_bg` tool returned a message containing "in background"
- The `halt` tool returned a message containing "Halted"
- The minion's transcript file exists at `/tmp/logs/pi-minions/minions/<id>-<name>.log` (confirming the minion was running before halt)

## Cleanup

None.
