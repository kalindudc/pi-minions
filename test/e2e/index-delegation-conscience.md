# Test: delegation-conscience

Verify that the delegation conscience feature injects delegation hints when appropriate.

## Setup

None.

## Action

Perform a complex task that triggers the delegation conscience:

1. Execute 5+ tool calls by reading multiple files:
   - `read: package.json`
   - `read: README.md`
   - `read: src/index.ts` (or any 3+ files)

2. After the 5th tool call, end this turn and start over, observe the system prompt modification

Alternative test - use a keyword trigger:
3. Send prompt: "Investigate the codebase structure"

## Expected

- The system prompt includes "DELEGATION REMINDER" text
- The hint mentions the number of tool calls made
- The hint suggests delegating tasks to minions parallel execution

## Verification

Check the session entries for system prompt modifications:

```bash
# The system prompt modification should appear in the session
# Look for "DELEGATION OPPORTUNITY" in the session file
grep -i "delegation reminder" ~/.pi/sessions/*.jsonl 2>/dev/null || echo "Session files not accessible in test environment"

# Debug log should show the conscience triggered
grep -i "delegation\|conscience" /tmp/logs/pi-minions/debug.log 2>/dev/null || echo "Check debug log manually"
```

## Cleanup

None.

## Notes

This test verifies the "Option B" implementation:
- Active injection via `context` event
- System prompt modification at threshold (5 tool calls)
- Keyword-based triggering for complex tasks

The feature should be transparent to users but visible in the LLM context.
