# Task Basis

## Classification

maintenance

## Product Intent

Status: NOT_REQUIRED
Link:
Reason: This is engineering maintenance for the team-owned Trellis fork and does not add business-facing product behavior.

## Requested Outcome

Adopt the audited upstream 0.6.14 baseline, retain only necessary Ecochain distribution customizations, and implement the approved classified governance handoff.

## Decision Order

When sources disagree, apply them in this order:

1. Preserve the audited upstream 0.6.14 baseline and use upstream implementations for capabilities it already provides.
2. Implement the approved 2026-08-10 handoff on the current upstream architecture.
3. Reapply a legacy Ecochain customization only when it is still required, is not already covered upstream, and does not conflict with the handoff.

Historical fork commits are audit evidence, not a requirement to restore every prior customization.

## In Scope / Out of Scope

- In scope: the `@ecochain` distribution identity, GitLab-first source/release configuration, classified task governance, bootstrap fit/gap behavior, workflow and verification semantics, template parity, and repository-native validation.
- Out of scope: GitLab API/pipeline implementation, Sonar implementation, ai-governance source changes, and upstream 0.7 beta work.
- Explicitly removed: the Aliyun npm registry configuration and any workflow, documentation, or script behavior that forces npm commands to use it.
- GitHub publishing is retained only as a manually triggered recovery path; normal source and release operations remain GitLab-first.

## Acceptance or Verification Basis

- The approved 2026-08-10 handoff and upstream/fork audit define the change basis.
- Focused lifecycle, bootstrap, template, and distribution tests must pass.
- The complete CLI test, typecheck, lint, build, and format checks must pass or have an evidence-backed environmental blocker.
