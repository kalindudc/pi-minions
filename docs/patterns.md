# Patterns

How-to recipes for foreground minion delegation.

## Delegate one isolated task

Use a single foreground minion when a task needs focused context and the parent needs the result before continuing.

```ts
spawn({ task: "Inspect src/config.ts and summarize supported settings" })
```

## Run independent work in parallel

Use batch `tasks` for independent investigations.

```ts
spawn({
  tasks: [
    { task: "Audit source files for removed public tools" },
    { task: "Audit tests for foreground visibility coverage" },
    { task: "Audit docs for current command examples" }
  ]
})
```

Return summaries from each minion, then integrate the findings in the parent.

## Use named agents

```ts
list_agents({})
spawn({ agent: "researcher", task: "Research the package publishing behavior" })
```

Named agents are discovered from global and project agent/minion directories. If no named agent is needed, omit `agent` to use an ephemeral minion.

## Monitor active foreground minions

```text
/minions
/minions show kevin
```

Use `list_minions` for a text summary and `show_minion` for a detailed status/activity report.

```ts
list_minions({})
show_minion({ target: "kevin" })
```

## Stop runaway work

```ts
halt({ id: "kevin" })
halt({ id: "all" })
```

A halted foreground minion reports an intentional stop. Do not retry automatically unless the user asks.

## Teach the parent agent

Use the learn surface when a model is unsure how to delegate:

```ts
learn_minions({})
```

Users can also run `/minions learn` or `/minions skill`.
