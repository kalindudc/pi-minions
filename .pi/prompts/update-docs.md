---
name: update-docs
description: Review implementation and update documentation to match current state
---

# Update Documentation

Review the current implementation in `src/` and ensure all documentation is accurate and up-to-date.

## Documentation Audit

### 1. API Reference (`docs/reference.md`)

Check that all public APIs are documented:

**Tools (LLM-callable):**
```bash
ls src/tools/*.ts
```

For each tool file:
- Verify documented in docs/reference.md
- Check schema matches implementation
- Verify examples are accurate
- Check behavior description is current

**Commands (User-initiated):**
```bash
grep -r "registerCommand" src/
```

For each command:
- Verify documented in docs/reference.md
- Check syntax and flags are accurate
- Verify examples work
- Check subcommands are listed

**Types:**
```bash
grep -r "export.*interface\|export.*type" src/types.ts src/tree.ts src/queue.ts
```

For each exported type:
- Verify documented in docs/reference.md
- Check fields match implementation

### 2. Usage Patterns (`docs/patterns.md`)

Check workflows match current behavior:

**Foreground vs Background:**
- Test examples still work
- Decision table is accurate
- Data flow diagrams reflect current implementation

**Common Patterns:**
- Verify each pattern example is valid
- Check for new patterns to document
- Remove obsolete patterns

### 3. README.md

Check accuracy of:

**Installation:**
- Installation command works
- Configuration example is correct

**Quick Start:**
- Examples are copy-pasteable
- Commands shown are current

**Features list:**
- All current features listed
- No removed features mentioned
- Descriptions accurate

**Commands & Tools table:**
- All commands/tools listed
- Descriptions match implementation

### 4. Roadmap (`docs/roadmap.md`)

Update completion status:

**Completed sections:**
- Check CHANGELOG for what's actually been done
- Move items from "Planned" to "Completed" if done
- Update version numbers

**Planned sections:**
- Remove items if decided against
- Add new planned features
- Update priorities

### 5. CHANGELOG.md

Verify Unreleased section:

- Check for implemented features not listed
- Verify all items are accurate
- Format: `type: description` (feat/fix/docs/chore/test/perf/refactor)
- Only significant changes (skip minor tweaks)

## Discovery Process

1. **Read source files** to understand current implementation
2. **Read corresponding docs** to check accuracy
3. **Identify gaps:**
   - Implementation exists but not documented
   - Documentation exists but implementation changed
   - Examples that don't work anymore
4. **Propose updates** in structured format

## Output Format

For each documentation file that needs updates, provide:

```
FILE: docs/reference.md

ISSUES FOUND:
- spawn_bg tool missing 'name' field in schema (implementation has it)
- /minions bg command example uses old syntax
- steer_minion tool not documented

PROPOSED CHANGES:
1. Add 'name' field to spawn_bg schema
2. Update /minions bg example to use current syntax
3. Add steer_minion section with schema and examples
```

## Implementation

After reporting findings:

1. Ask user which updates to apply
2. Use edit tool to update documentation files
3. Show diff for review
4. If approved, add to CHANGELOG under Unreleased → Documentation

## Example Findings

```
FILE: docs/reference.md

ISSUES FOUND:
- Section "Tools > spawn" shows old exitCode field, but implementation uses status
- Missing documentation for detach mechanism
- /minions steer command not in reference

PROPOSED CHANGES:
1. Update spawn return type schema (exitCode → status)
2. Add "Live Detach" subsection under spawn tool
3. Add /minions steer to Commands section

---

FILE: README.md

ISSUES FOUND:
- Installation shows TBD but should use git install
- Environment variables section missing PI_MINIONS_DEBUG

PROPOSED CHANGES:
1. Update Quick Start with: pi install https://github.com/kalindudc/pi-minions
2. Add Environment Variables section with PI_MINIONS_DEBUG

---

FILE: docs/patterns.md

ISSUES FOUND:
- "Nested Spawning" section says "not yet implemented" but it's intentionally blocked
- Missing pattern for steering mid-execution

PROPOSED CHANGES:
1. Update Nested Spawning to clarify it's intentionally prevented (not coming)
2. Add "Steering Mid-Execution" pattern with examples
```

## After Updates

Add to CHANGELOG.md under Unreleased:

```markdown
docs: updated API reference for spawn tool
docs: added live detach and steering documentation
docs: clarified nested spawning limitation
```
