# Test Layering

## Goal

Ensure each requirement is assigned to the lowest-cost, highest-stability test layer instead of defaulting to brittle UI automation.

## Layers

### API / Service Guards

Use for:
- business rules
- state transitions
- idempotency
- permissions
- integration contracts

Prefer this layer when:
- correctness matters more than operator interaction
- outcomes can be asserted without UI
- the same rules affect multiple screens

### Stable UI Regression

Use for:
- critical operator journeys
- high-value flows that must remain in CI
- workflow checkpoints visible to users

Prefer this layer when:
- the scenario represents real business value
- the UI path must remain stable across releases
- operator-visible outcomes matter

### Natural Language Draft Flows

Use for:
- new pages
- fast-changing workflows
- exploratory automation before hardening

Prefer this layer when:
- the feature is still moving
- stable selectors and abstractions are not ready
- the team wants quick coverage before promotion

### Manual Exploration

Use for:
- rare operations
- low-value edge paths
- highly visual or hardware-coupled scenarios

Prefer this layer when:
- maintenance cost would exceed value
- automation would be too fragile
- cross-system or device dependencies are still unstable

## Layering Rules

- Start from API / service guards whenever they can prove the requirement.
- Keep only a small set of stable UI regressions for the core operator path.
- Treat natural language flows as draft assets, not long-term regression assets.
- Do not automate everything. Keep manual exploration where cost outweighs value.
- Reuse stable abstractions before adding new UI cases.
- Prefer short critical-path assertions over long end-to-end UI chains when stability is the priority.
