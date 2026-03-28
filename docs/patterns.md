# Usage Patterns

## Foreground vs Background

| Use Case | Mode | Why |
|----------|------|-----|
| Need result to proceed | Foreground | Blocking is intentional |
| Long-running task (>1min) | Background | Don't wait unnecessarily |
| Multiple independent tasks | Background | Parallelize work |
| Quick analysis (<1min) | Foreground | Minimal wait, context preserved |
| Review/validation | Foreground | Immediate feedback required |
| Exploratory research | Background | Results inform later work |

**Foreground example:**
```bash
/spawn Analyze error logs and identify root cause
# Wait for result, then fix issue
```

**Background example:**
```bash
/spawn --bg Run full test suite and report failures
# Continue working, result delivered when complete
```

---

## Parallel Research

Run multiple tasks simultaneously:

```bash
/spawn --bg Research React 19 server components
/spawn --bg Research Next.js 15 app router changes  
/spawn --bg Research Vercel edge function best practices
```

**Advantages:** Wall-clock time = slowest task (not sum)  
**Trade-off:** Higher token usage, results may arrive out-of-order

---

## Live Detach

Start foreground, detach if it takes longer than expected:

```bash
/spawn Analyze codebase and create refactoring plan
# Taking too long...
/minions bg planning-minion
# Parent unlocks, minion continues, result queued
```

**Key:** Same session continues—no interruption.

---

## Steering

Adjust running minion mid-execution:

```bash
/spawn --bg Run full test suite and analyze failures
# Later...
/minions steer test-runner "Focus only on integration tests"
```

**When to use:**
- Refine scope based on early findings
- Prioritize specific areas
- Add constraints (time, cost, focus)

**Limitation:** Message injected before next LLM call, not instantaneous.

---

## Abort & Retry

```bash
/spawn Research migration strategies
# Minion is off-track...
/halt researcher
/spawn Research React migration, not Angular
```

**Key:** Abort throws `[HALTED]` error. LLM sees "do NOT retry"—user must explicitly re-spawn.

---

## Cost Control

Monitor usage:
```bash
/minions show researcher
# Shows: Usage: Input: 12,345 tokens, Output: 6,789 tokens, Cost: $0.234
```

Abort high-cost tasks:
```bash
/halt expensive-task
```

Use cheaper models:
```bash
/spawn --model claude-3-5-haiku-20241022 Summarize this log file
```

---

## Named Agents

Discover agents:
```bash
# LLM calls list_agents, or manually:
ls ~/.pi/agent/agents/
ls .pi/agents/
```

Use specialized agents:
```bash
/spawn --agent researcher Research TypeScript 5.7 changes
/spawn --agent reviewer Review PR #42 for security issues
```

**Agent definition:**
```markdown
---
name: researcher
description: Research with citation tracking
model: claude-3-5-sonnet-20241022
---
[System prompt content]
```

---

## Common Mistakes

**Don't spawn too many:** Limit to 2-3 parallel minions. Group related tasks.

**Don't background when you need the result immediately:**
```bash
# Bad: /spawn --bg Analyze logs; # immediately try to fix
# Good: /spawn Analyze logs; # wait, then fix
```

**Don't ignore background results:** Review via `/minions show`. Use findings in subsequent work.

**Don't over-steer:** Too many steering messages → confusion. Abort and re-spawn instead.

---

## Tips

- **Monitor long tasks:** `/minions show <name>` to check progress and cost
- **Review transcripts:** `cat tmp/logs/minions/<id>-<name>.log` for debugging
- **Emergency stop:** `/halt all` aborts everything
- **Cheaper models:** Use haiku for low-stakes tasks
- **Named backgrounds:** Infer name from task via `/minions list`
