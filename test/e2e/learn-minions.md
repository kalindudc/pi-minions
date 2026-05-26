# Test: learn-minions

Verify that the built-in learning surface is available without packaged docs.

## Setup

None.

## Action

Call the `learn_minions` tool with no parameters.

## Expected

- The result contains `# pi-minions`
- The result mentions foreground `spawn`
- The result mentions batch `tasks`
- The result mentions `list_agents`
- The result states `Background minions are not available`
- The result states `Live detach is not available`
- The result states `User steering is not available`

## Cleanup

None.
