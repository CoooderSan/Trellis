# Fix Windows npm invocation in release scripts

## Goal

Fix Windows npm invocation in manifest continuity and manifest creation scripts, then rerun release and MR gates.

## Requirements

- Use one shared npm invocation helper for release scripts so Windows runs `npm.cmd` through `cmd.exe` and Unix keeps direct `npm` execution.
- Apply the helper to both migration-manifest continuity lookup and published-manifest overwrite protection.
- Preserve current failure policy: continuity fails closed on non-404 npm failures; manifest creation continues to fail open on lookup/network errors.
- Add regression tests for Windows and Unix invocation shapes and for both script call sites.
- Do not change versions, tags, registries, or publication state.

## Acceptance Criteria

- [x] `check-manifest-continuity.js` uses the shared cross-platform npm invocation contract.
- [x] `create-manifest.js` uses the same contract without weakening its existing published-version guard semantics.
- [x] Focused release tests cover Windows `cmd.exe /d /s /c npm.cmd` and Unix `npm` behavior for both call sites.
- [x] CLI tests, lint, typecheck, build, and release preflight checks pass.

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
