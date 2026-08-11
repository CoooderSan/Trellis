---
description: "Trellis Copilot prompt: check.prompt"
---

# Code Quality Check

Comprehensive `ITERATION`-profile verification for the current worktree. Combine task/spec compliance, risk-appropriate checks, cross-layer safety, and evidence that remains bound to the change identity it actually checked.

---

## Step 1: Identify What Changed

```bash
git diff --name-only HEAD
git status
```

Record the iteration identity: worktree, HEAD when applicable, and the exact dirty diff/change scope being checked. If any of those change later, affected evidence is stale and must be rerun or marked invalid.

## Step 2: Read Task Artifacts and Applicable Specs

Read the current task artifacts in order:

- `prd.md`
- `design.md` if present
- `implement.md` if present

```bash
python3 ./.trellis/scripts/get_context.py --mode packages
```

For each changed package/layer, read the spec index and follow its **Quality Check** section:

```bash
cat .trellis/spec/<package>/<layer>/index.md
```

Read the specific guideline files referenced — the index is a pointer, not the goal.

## Step 3: Choose and Run Risk-Appropriate Checks

TDD is optional and risk-driven. Prefer it for reproducible bugs, business rules, state machines, algorithms, and pure logic whose expected behavior can be expressed before implementation.

Discover and run the repository's applicable lint, type-check, tests, builds, contract checks, integration checks, and runtime probes. Configuration, device-dependent behavior, cross-system integration, or legacy seams may require logs or explicit manual verification instead of a particular automated test category.

If a check is not configured, not applicable, or intentionally skipped, do not treat that absence as a pass. Record the reason and provide proportionate alternative verification evidence. Exit code zero alone does not prove that tests were discovered or executed.

## Step 4: Review Against Checklist

### Code Quality

- [ ] Applicable lint/type/build/test/contract/integration/runtime checks have evidence?
- [ ] Test discovery/execution is confirmed rather than inferred from exit code alone?
- [ ] No debug logging left in?
- [ ] No suppressed warnings or type-safety bypasses?

### Behavior Coverage

- [ ] Changed behavior and identified risks are covered by automated checks or explicit alternative evidence?
- [ ] Reproducible bug/regression paths have a durable prevention check when practical?
- [ ] `NOT_APPLICABLE` / `SKIPPED` checks include a reason?

### Spec Sync

- [ ] Does `.trellis/spec/` need updates? (new patterns, conventions, lessons learned)

> "If I fixed a bug or discovered something non-obvious, should I document it so future me won't hit the same issue?" → If YES, update the relevant spec doc.

## Step 5: Cross-Layer Dimensions (if applicable)

Skip this step if your change is confined to a single layer.

### A. Data Flow (changes touch 3+ layers)

- [ ] Read flow traces correctly: Storage → Service → API → UI
- [ ] Write flow traces correctly: UI → API → Service → Storage
- [ ] Types/schemas correctly passed between layers?
- [ ] Errors properly propagated to caller?

### B. Code Reuse (modifying constants, creating utilities)

- [ ] Searched for existing similar code before creating new?
  ```bash
  grep -r "pattern" src/
  ```
- [ ] If 2+ places define same value → extracted to shared constant?
- [ ] After batch modification, all occurrences updated?

### C. Import/Dependency (creating new files)

- [ ] Correct import paths (relative vs absolute)?
- [ ] No circular dependencies?

### D. Same-Layer Consistency

- [ ] Other places using the same concept are consistent?

---

## Step 6: Report and Fix

Report violations found and fix them directly. Re-run affected checks after fixes.

Report each check using the shared status vocabulary:

- `PASSED`, `FAILED`, `NOT_CONFIGURED`, `NOT_APPLICABLE`, `SKIPPED`, `PENDING`, `UNKNOWN`, or `PLANNED`
- identity: worktree, HEAD when applicable, dirty diff/change scope
- evidence: command or observation, checked object, key result, time, and source
- invalidation: which code, HEAD, target, configuration, or environment changes make the evidence stale

Required facts at `FAILED`, `UNKNOWN`, or `PENDING` are not green and cannot support an MR-ready claim. Do not alter Sonar, pipeline, or platform facts to manufacture a pass. `check.jsonl` is only a sub-agent context manifest; never write quality results into it.

This prompt reports `ITERATION` evidence. An `MR_CANDIDATE` claim additionally requires an exact source SHA, fetched target SHA, and complete candidate diff checked by the repository's merge-request gate.
