# Testing Workflow

## Goal

Define the minimum closed-loop workflow for AI-assisted testing so teams can move from `PRD / intent` to reusable regression cases and summaries without skipping planning, execution evidence, or failure triage.

## Scope

This workflow is designed for:
- products that need reusable regression assets instead of one-off automation drafts
- teams that want to move from requirements to executable test assets and reusable summaries

This workflow is not optimized for:
- purely visual consumer web pages
- creative visual QA without structured assertions
- device farms or hardware orchestration platforms

## Five Stages

### 1. `test-design`

Purpose:
- Convert `PRD / intent` into a layered test plan and case strategy.

Required inputs:
- `PRD / intent`
- related design docs
- existing regression assets
- regression asset repository metadata
- historical failures or known risks
- environment and test data constraints

Required outputs:
- layered test plan
- test cases and MVTests
- risk list
- reuse suggestions

### 2. `test-generate`

Purpose:
- Generate draft test cases and reusable support pieces from the approved design.

Required inputs:
- layered test plan
- existing regression assets
- regression asset repository structure
- reusable Playwright abstractions
- data setup requirements

Required outputs:
- API or service guard drafts
- Playwright draft cases
- fixture / helper / reusable abstraction candidates

### 3. `test-execute`

Purpose:
- Execute test cases and collect complete evidence.

Required inputs:
- draft or stable test cases
- execution environment
- accounts and permissions
- test data
- CLI execution parameters

Required outputs:
- pass / fail summary
- trace
- screenshots
- logs
- videos when needed

### 4. `test-analyze`

Purpose:
- Explain failures and evaluate coverage gaps.

Required inputs:
- execution results
- evidence from `test-execute`
- expected behavior from requirements
- existing regression baseline
- regression asset repository baseline

Required outputs:
- primary failure category
- coverage gaps
- brittle spots
- revision recommendations

### 5. `test-promote`

Purpose:
- Promote validated draft cases into stable regression cases and reusable support assets.

Required inputs:
- validated draft cases
- analysis results
- reuse value judgement
- maintenance cost judgement

Required outputs:
- stable regression cases
- updated regression inventory
- promoted helpers, fixtures, or reusable abstractions

## Non-Negotiable Rules

- Do not skip `test-design` and go straight to script writing.
- Do not treat every acceptance criterion as a UI test.
- Do not run `test-execute` without collecting reusable evidence.
- Do not report only pass / fail; `test-analyze` must classify the likely root cause.
- Do not promote draft cases into the regression pool until stability requirements are met.

## Existing Regression Assets

Existing regression assets are explicit workflow inputs, not optional references.

They must be checked during:
- `test-design`
- `test-generate`
- `test-analyze`

Examples:
- Playwright cases
- page objects
- flow objects
- fixtures
- assertion helpers
- test data setup scripts

## Regression Asset Repository

The workflow assumes a Git-managed regression asset repository or equivalent versioned asset store.

At minimum, the workflow must know:
- repository location or checkout path
- target module or feature area
- available Playwright abstractions
- historical execution baseline for the target area

`test-design` and `test-generate` must query this repository before proposing new assets.
`test-design` and `test-generate` must query this repository before proposing new cases or support abstractions.

## Minimum Input Contract

Each testing request should provide, or be able to resolve:
- target `PRD / intent`
- target
- target environment
- test roles or accounts
- test data assumptions
- regression asset repository location
- whether the run is for draft validation or formal regression

## Public Skills And Internal Steps

For the first iteration, only these stages are exposed as public skills:
- `test-design`
- `test-execute`
- `test-analyze`

These stages remain internal workflow steps for now:
- `test-generate`
- `test-promote`

Reason:
- keep the public surface area small
- stabilize the workflow before exposing every phase
- avoid overfitting early skill boundaries
