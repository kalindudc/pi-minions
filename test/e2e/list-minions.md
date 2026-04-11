# Test: list-minions

Verify that the `list_minion_types` tool shows running minions.

## Setup

None.

## Action

First, call the `spawn_bg` tool with:
- `agent`: `e2e-slow`
- `task`: `Read every file in the src/ directory one by one. For each file provide a detailed 1000 word analysis.`

Extract the minion name from the spawn_bg response.

Wait 2 seconds, then call the `list_minion_types` tool.

After checking, call the `halt` tool with:
- `id`: `all`

## Expected

- The `list_minion_types` result contains the word "Running"
- The `list_minion_types` result contains the minion name from the spawn_bg response

## Cleanup

None.
