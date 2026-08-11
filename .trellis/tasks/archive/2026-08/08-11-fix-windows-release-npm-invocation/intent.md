# Task Basis

## Classification

review-revision

## Product Intent

Status: NOT_REQUIRED
Link:
Reason: Author self-review of candidate `342a0ae3` found a scoped Windows compatibility defect in the 0.6.14 maintenance change.

## Requested Outcome

Fix Windows npm invocation in manifest continuity and manifest creation scripts, then rerun release and MR gates.

## In Scope / Out of Scope

- In scope: Windows-safe npm process invocation for the manifest continuity and manifest creation release scripts, plus focused regression coverage.
- Out of scope: changing package versions, publishing packages, changing npm registry configuration, or redesigning release behavior.

## Acceptance or Verification Basis

- Author self-review finding against `private/main...feat/upstream-0.6.14-ecochain` identified direct `execFileSync("npm", ...)` calls that fail against Windows `.cmd` shims.
- Focused tests must prove both scripts route npm through `cmd.exe /d /s /c npm.cmd` on Windows while preserving the direct Unix invocation.
- Full repository-native MR and release gates must pass after the fix.
