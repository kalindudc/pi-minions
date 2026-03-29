---
name: release
description: Create semantic versioning release with auto-generated changelog
---

# Release Workflow

Create release for pi-minions with semantic versioning and CHANGELOG generation.

## Preflight

Run checks, STOP if any fail:

1. Branch: `git rev-parse --abbrev-ref HEAD` → must be `main`
2. Working dir: `git status --porcelain` → must be empty
3. Current version: `grep '"version"' package.json`
4. Commits since last tag:
   ```bash
   LAST=$(git describe --tags --abbrev=0 2>/dev/null)
   if [ -n "$LAST" ]; then
     git log $LAST..HEAD --format="%h|%s|%b|||"
   else
     git log --format="%h|%s|%b|||"
   fi
   ```
   - No commits → inform user "No changes since last release", STOP
   - No tags → suggest v0.1.0 or v1.0.0, ask user preference

## Parse Commits

**Extract from subject + body:**
```
Input: feat: add resume support\n\nAlso fixes memory leak
Output:
  feat: add resume support
  fix: memory leak
```

**Categorize:**
- `feat:` or `feat(scope):` → MINOR
- `fix:` or `fix(scope):` → PATCH
- `docs:`, `chore:`, `test:` → PATCH
- `BREAKING CHANGE:` in body or `!` after type/scope → MAJOR

**Version bump priority:**
1. Any BREAKING → MAJOR (X+1).0.0
2. Any feat → MINOR X.(Y+1).0
3. Only fix/docs/chore/test → PATCH X.Y.(Z+1)

**Combine related changes:** Multiple related commits → single CHANGELOG entry

## Generate CHANGELOG

Format:
```markdown
## [X.Y.Z] - YYYY-MM-DD

- feat: description
- feat: another feature
- fix: bug description
- docs: documentation update
- chore: maintenance task
- test: test changes
```

Rules:
- Group by type (feat, fix, docs, chore, test)
- Skip minor tweaks and trivial changes
- Combine related changes into single entry
- Order: feat, fix, docs, chore, test
- Only include significant changes

## Update documentation

Update all version references in docs, READMEs and AGENT.md

## Present Plan

Show user:
```
Analyzing commits since vX.Y.Z...

Found N commits:
- M features (feat:)
- P bug fixes (fix:)
- Q documentation (docs:)
- R chores (chore:)

Version bump: X.Y.Z → A.B.C (TYPE - reason)

CHANGELOG entry:
## [A.B.C] - YYYY-MM-DD

- feat: feature description
- fix: fix description
- docs: documentation update
- chore: maintenance task

Ready to create release vA.B.C? I will:
1. Update package.json version
2. Update CHANGELOG.md
3. Show diff for review
4. Instruct you to run release script
```

Ask for user confirmation.

## Update Files (On Approval)

1. Edit `package.json` → update version to A.B.C
2. Edit `CHANGELOG.md` → insert new entry after `## [Unreleased]`
3. Show diff: `git diff package.json CHANGELOG.md`
4. Instruct user:
   ```
   ✅ Files prepared for release vA.B.C

   Review the diff above. If everything looks correct, finalize:

     ./scripts/release.sh

   The script will:
   1. Read version A.B.C from package.json
   2. Create commit: "chore: release vA.B.C"
   3. Create git tag: vA.B.C
   4. Push to origin with tags

   If you need to make changes, edit the files and run the script when ready.
   ```

**Do NOT create git commits or tags.** Leave that to the release script.

## Output Format

```
[Status of preflight checks]

Analyzing commits since vX.Y.Z...

Found N commits:
- M features (feat:)
- P fixes (fix:)
- Q docs (docs:)
- R chores (chore:)

Version bump: X.Y.Z → A.B.C (TYPE - reason)

CHANGELOG entry:
## [A.B.C] - YYYY-MM-DD

[formatted entries by type]

Ready to create release vA.B.C?
```
