# Test: timeout

Verify that a minion with `timeout: 15000` gets steered on timeout.

## Setup

None.

## Action

Call the `spawn` tool with:
- `agent`: `e2e-timeout`
- `task`: `Read every file in the src/ directory and every file in the test/ directory one by one. For each file provide a detailed 1000 word analysis.`

## Expected

- The spawned minion's transcript file exists
- The spawned minion's transcript contains the string `Timeout reached` OR the minion completed before 15s (if no timeout marker, pass with reason "minion completed before timeout")

## Cleanup

None.
