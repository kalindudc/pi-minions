# Patterns

> See also: [Getting started](getting-started.md) · [Agents](agents.md) · [Reference](reference.md)

## How to delegate a blocking task

**Problem:** You need a result before you can continue — an analysis, a code review, or a search result.

**Solution:** Use a foreground spawn. The parent blocks until the minion completes and returns its result directly.

```bash
/spawn Analyze error logs and identify root cause
# Parent waits → result returned → continue working
```

**When to use:** Quick tasks (<1 min), analysis that feeds into your next step, validation that needs immediate feedback.

---

## How to run tasks in parallel

**Problem:** You have multiple independent tasks and don't want to run them sequentially.

**Solution 1: Batch spawn (foreground)**

Use the `tasks` array to spawn multiple minions under one render block. All complete before the parent continues.

```javascript
spawn({
  tasks: [
    { task: "Analyze auth module" },
    { task: "Analyze payments module" },
    { task: "Analyze notifications module" }
  ]
})
```

**Solution 2: Multiple background spawns**

For fire-and-forget work, spawn background minions:

```bash
/spawn --bg Research React 19 server components
/spawn --bg Research Next.js 15 app router changes
```

**When to use:**
- Batch spawn: Related analysis tasks where you need all results before continuing
- Background spawns: Fire-and-forget research, long-running tests

---

## How to detach a slow foreground task

**Problem:** You started a foreground spawn but it's taking longer than expected. You don't want to kill it.

**Solution:** Live detach with `/minions bg`. The same session continues in the background — no interruption.

```bash
/spawn Analyze codebase and create refactoring plan
# Taking too long...
/minions bg planning-minion
# Parent unlocks immediately, minion keeps running, result queued
```

**When to use:** Any foreground task that turns out to be longer than expected. The minion keeps its full context and progress.

---

## How to redirect a running minion

**Problem:** A minion is running but you want to refine its scope, reprioritize, or add constraints.

**Solution:** Steer it with `/minions steer`. The message is injected before the minion's next LLM call.

```bash
/spawn --bg Run full test suite and analyze failures
# Minion starts running all tests...
/minions steer test-runner "Focus only on integration tests"
```

**When to use:**
- Refine scope based on early findings
- Reprioritize specific areas
- Add constraints (time, cost, focus area)

> [!NOTE]
> Steering is not instantaneous — the message is injected before the next LLM call. If the minion is mid-tool-execution, there may be a delay. For major direction changes, consider aborting and re-spawning instead.

---

## How to abort and retry

**Problem:** A minion is off-track or wasting tokens. You want to stop it and start fresh.

**Solution:** Halt the minion and spawn a new one with a refined task.

```bash
/spawn Research migration strategies
# Minion is researching the wrong framework...
/halt researcher
/spawn Research React migration from v18 to v19, not Angular
```

**When to use:** The minion misunderstood the task, is going down the wrong path, or is consuming too many tokens.

> [!WARNING]
> Halt throws a `[HALTED]` error — the LLM sees "do NOT retry." You must explicitly re-spawn. Use `/halt all` as an emergency stop for all running minions.

---

## How to control costs

**Problem:** Minions can be expensive — long-running tasks with powerful models add up.

**Solution:** Use a combination of monitoring, model overrides, and safety limits.

**Monitor usage:**
```bash
/minions show researcher
# Shows: Usage: Input: 12,345 tokens, Output: 6,789 tokens, Cost: $0.234
```

**Use cheaper models for low-stakes tasks:**
```bash
/spawn --model claude-haiku-4-5 Summarize this log file
```

**Set safety limits in agent config:**
```markdown
---
name: quick-check
description: Fast validation
steps: 10
timeout: 30000
---
```

**Abort expensive tasks:**
```bash
/halt expensive-task
```

See [Agents — Frontmatter reference](agents.md#frontmatter-reference) for all safety limit options.

---

## How to use named agents for repeated tasks

**Problem:** You keep spawning minions with the same instructions (research, review, testing).

**Solution:** Create a named agent with a reusable configuration. See [Agents](agents.md) for the full guide.

```bash
# Create once
cat > .pi/agents/reviewer.md << 'EOF'
---
name: reviewer
description: Code review with security focus
model: claude-sonnet-4-20250514
steps: 30
---
Review code for bugs, security issues, and maintainability.
Focus on: input validation, error handling, auth boundaries.
EOF

# Use repeatedly
/spawn --agent reviewer Review the authentication module
/spawn --agent reviewer Review the payment processing changes
```

---

## Common mistakes

**Spawning too many concurrent minions.** Limit to 2-4 parallel background minions. Group related tasks into a single minion instead of spawning one per file.

**Backgrounding when you need the result immediately.** If your next step depends on the minion's output, use foreground. Background is for fire-and-forget.

```bash
# Bad: need result immediately but backgrounded
/spawn --bg Analyze logs
# Can't use the analysis yet...

# Good: foreground when result is blocking
/spawn Analyze logs
# Result available, now fix the issue
```

**Ignoring background results.** Review completed minion output via `/minions show`. Unread results are auto-delivered but may contain important findings or errors.

**Over-steering.** Too many steering messages confuse the minion's context. If the task needs a major redirect, abort and re-spawn with a clearer prompt.
