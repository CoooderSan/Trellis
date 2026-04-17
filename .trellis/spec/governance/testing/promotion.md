# Promotion Rules

## Goal

Define when draft test assets are allowed to become stable regression assets.

## Promotion Criteria

A draft asset can be promoted only when:
- business value is high enough
- required test data is reproducible
- assertions are deterministic
- execution evidence is stable across repeated runs
- failures are more often product issues than script drift
- maintenance cost is acceptable

## Promotion Targets

- stable Playwright cases
- page objects
- flow objects
- fixtures
- assertion helpers

## Do Not Promote

- one-off exploratory scripts
- unstable natural-language-only flows
- scenarios blocked by unresolved environment dependencies
- low-value paths with high maintenance cost
