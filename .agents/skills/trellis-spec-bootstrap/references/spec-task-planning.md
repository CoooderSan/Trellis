# Spec Task Planning

Use the current agent as the integration owner. The execution mode may be
inline or may use optional helpers, but the skill must not require a specific
platform, CLI, fixed worker pair, or parallel topology.

Creator bootstrap may use a task for a durable fit/gap review. Joiner onboarding
must not decompose work that recreates or rewrites the existing project specs;
credible gaps found by a joiner belong in separate maintenance work.

## Decomposition

When gaps actually exist, create spec work units around real ownership boundaries:

- One package when a package has its own conventions.
- One layer when the same package has distinct frontend, backend, CLI, worker, or shared-library rules.
- One cross-cutting guide when a pattern spans packages and is not owned by one layer.

Avoid artificial decomposition. No gap means no write task. A small library
usually needs one focused spec pass, not several tasks.

## Task Shape

When a Trellis task is useful, write a concise PRD with these sections:

```markdown
# Resolve <package-or-layer> Trellis Spec Gaps

## Goal

Review loaded guidance and resolve the evidence-backed project-specific gaps in
<scope>.

## Scope

- Spec directory:
- Source directories to inspect:
- Tests to inspect:
- Out of scope:

## Architecture Context

Summarize the concrete findings from repository analysis.

## Loaded Baseline

- Registry/template source:
- Guidance already applicable:
- Evidence for each remaining gap:

## Files To Create Or Update

- `.trellis/spec/.../index.md`
- `.trellis/spec/.../<topic>.md`

## Rules

- Preserve applicable team guidance and adapt only demonstrated gaps.
- Use real source examples with file paths.
- Remove template-only sections that do not apply.
- Do not modify product source code unless the task explicitly asks for it.

## Acceptance Criteria

- [ ] Specs contain concrete examples and anti-patterns from the repository.
- [ ] No placeholder text remains.
- [ ] Index files match the final spec files.
- [ ] Claims are backed by source files, tests, or project docs.
```

## Optional Helper Agents

If the host supports subagents, helpers can inspect independent packages or run verification. They are optional. Inline execution is equally valid; the main agent still owns integration and final quality.

Helper tasks must have clear ownership:

- Read-only research tasks may inspect any source needed for the assigned scope.
- Write tasks should own disjoint spec directories.
- Verification tasks should check placeholder removal, broken links, and consistency.

Do not encode helper-agent names, vendor-specific commands, or platform-specific routing in the skill. Put only the required work and acceptance criteria in the task.
