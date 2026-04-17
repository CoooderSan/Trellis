# Failure Triage

## Goal

Standardize how test failures are classified so teams do not stop at "automation failed".

## Primary Categories

### Product Defect

Use when:
- behavior violates requirement or expected outcome
- the same failure reproduces with valid data and stable steps

### Environment / Data

Use when:
- environment is unavailable or inconsistent
- required data is missing or polluted
- permissions or account state block valid execution

### Script Drift

Use when:
- page changes break automation while product behavior is still correct
- selectors, anchors, or page assumptions are stale

### Requirement Gap

Use when:
- expected behavior is ambiguous or undocumented
- the script and implementation differ because the requirement is unclear

## Rules

- Every failed run must have exactly one primary category.
- If evidence is insufficient, report the most likely category and what is missing.
- Keep product defects separate from automation maintenance issues.
- When reporting triage, always state the affected environment, role, and business object or module.
