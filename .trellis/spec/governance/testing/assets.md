# Test Assets

## Goal

Define what counts as a reusable test asset and how assets participate in the workflow.

## Storage Model

Test assets should be managed in a Git repository or another versioned asset store with equivalent review and rollback capabilities.

This specification assumes Git as the default model because teams need:
- version control
- code review
- traceable evolution with requirement changes
- branch-based experimentation
- rollback for unstable test changes

## Asset Types

- Playwright regression cases
- page objects
- flow objects
- fixtures
- assertion helpers
- test data setup scripts
- execution presets
- asset inventory or manifest files
- module-level regression ownership notes

## Asset Pools

### Draft Asset Pool

Contains:
- newly generated cases
- unstable UI flows
- exploratory automation

Characteristics:
- not yet trusted as regression baseline
- may change quickly
- used for learning and iteration

### Regression Asset Pool

Contains:
- promoted stable Playwright assets
- reusable abstractions already proven in repeated runs

Characteristics:
- reusable in CI or release regression
- deterministic enough for repeated execution
- acts as baseline input for future design and analysis

## Repository Inputs

When the workflow references an existing regression asset repository, it should resolve:
- repository path or remote
- target module directory
- asset ownership or maintainers
- available helpers, fixtures, and abstractions
- recent failures or flaky asset history if available

## Suggested Layout

A regression asset repository does not need one universal structure, but it should make these areas easy to locate:
- `tests/` or equivalent for executable regression cases
- `page-objects/` or equivalent for page abstractions
- `flows/` for business journey abstractions
- `fixtures/` for reusable setup
- `data/` or `scripts/` for seed and cleanup helpers
- `reports/` or historical links for baseline evidence

## Workflow Usage

- `test-design`: check existing regression assets before defining gaps
- `test-generate`: reuse current abstractions before generating new ones
- `test-analyze`: compare new failures against current regression baseline
- `test-promote`: move qualified draft assets into the regression pool
