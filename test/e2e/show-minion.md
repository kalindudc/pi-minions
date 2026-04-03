# Test: show-minion

Verify that the `show_minion` tool displays detailed status of a minion.

## Setup

None.

## Action

First, call the `spawn_bg` tool with:
- `agent`: `e2e-slow`
- `task`: `Read every file in the src/ directory one by one. For each file provide a detailed 1000 word analysis.`

Extract the minion name and ID from the spawn_bg response.

Wait 2 seconds, then call the `show_minion` tool with:
- `target`: the minion name or ID from above

After checking, call the `halt` tool with:
- `id`: `all`

## Expected

- The `show_minion` result contains `Status: running`
- The `show_minion` result contains `Task:`

## Cleanup

None.
