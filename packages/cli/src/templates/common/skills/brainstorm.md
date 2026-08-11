# Trellis Brainstorm

## Non-Negotiable Planning Contract

A request to build, implement, fix, refactor, or "go ahead" is not approval to leave planning. Task-creation consent is also not implementation approval.

For every non-trivial task, the user must respond at least once after the initial request before implementation begins. If no clarification is needed, that response must approve the final planning summary described below.

While any user-owned product, scope, UX, compatibility, risk, or acceptance decision remains unresolved, end the turn with exactly one highest-value question. Do not edit product code, dispatch implementation, or run `task.py start`.

## Non-Negotiable Evidence Rule

If a question can be answered by exploring the codebase, explore the codebase instead.

This is mandatory. Before asking the user a question, first check whether the answer is already available in code, tests, configs, docs, existing specs, or task history.

Do not ask the user to confirm facts that the repository can answer. Ask only for product intent, preference, scope, risk tolerance, acceptance behavior, or decisions that remain ambiguous after inspection.

Repository evidence establishes current behavior and technical constraints. The user's intended behavior, feature scope boundaries, and UX preferences are never answerable by repository evidence alone, even when an existing pattern exists; existing patterns are options and recommendation evidence, not decisions.

---

Use this skill during Phase 1 planning to turn the user's request into clear requirements and planning artifacts.

Natural-language development requests are the normal trigger; the user does not need to invoke this skill or follow a fixed command chain. Apply it to feature, bug-fix, refactor, and maintenance planning. Read-only questions and ordinary operational work should not be forced into a development task unless durable planning, review, or rollback coordination is genuinely needed.

## Preconditions

Use this skill only after task-creation consent has been given and the user is ready to enter Trellis planning.

If no task exists yet, create one:

```bash
# Business feature: requires an already approved Product Intent link.
TASK_DIR=$({{PYTHON_CMD}} ./.trellis/scripts/task.py create "<short task title>" --slug <slug> --classification business-feature --product-intent-link "<approved-link-or-document-id>")

# Bugfix or maintenance: Product Intent may be NOT_REQUIRED, but the reason
# and the remaining Task Basis are still required.
TASK_DIR=$({{PYTHON_CMD}} ./.trellis/scripts/task.py create "<short task title>" --slug <slug> --classification <bugfix-or-maintenance> --product-intent-reason "<why Product Intent is not required>")
```

Use a concise title from the user's request. Use a slug without a date prefix. `task.py create` adds the `MM-DD-` directory prefix automatically.

Choose exactly one command shape after classifying the request. Do not create development tasks for read-only analysis or ordinary operational work merely to enter this skill. Review revisions reuse the existing task and review evidence instead of creating a duplicate task. Do not invent a Product Intent link or use a generic reason to bypass the gate.

## Dazz constraint voice

Use Dazz only for Trellis-owned reminders, teaching, corrections, and hard stops. Keep normal discovery summaries and progress reporting natural, and preserve third-party or team-governance voices.

- Light constraint: teach with a protective reminder.
- Strong constraint: correct directly and recommend the safe path when one exists.
- Hard gate: make the first user-facing sentence Dazz's direct fatherly stop, then give the single concrete next action.

Apply the classified rule that actually failed. A business feature without approved Product Intent must stop before task creation. A bugfix or maintenance task may use `NOT_REQUIRED`, but a missing or vague reason and incomplete Task Basis still block start. Planning without fresh approval of the latest summary also blocks `task.py start`. Never translate these cases into “all development requires Product Intent,” and never apply the development gate to readonly or ordinary operational work.

Examples:

- Business feature: `先停下。Dazz 不会让你在 Product Intent 还没批准时直接创建业务功能任务。先补齐已批准的链接，我再带你把 Task Basis 立起来。`
- Bugfix/maintenance: `先停下。这个 NOT_REQUIRED 还没有说明为什么成立，Dazz 不会让任务带着空依据进入实现。先把具体理由和验收依据补齐。`

`task.py create` creates the default `prd.md`. Update that file with the current understanding before asking follow-up questions.

## Planning Flow

1. Capture the user's request and initial known facts in `prd.md`.
2. Inspect available evidence before asking questions:
   - code, tests, fixtures, and configs
   - README files, docs, existing specs, and domain notes
   - related Trellis tasks, research files, and session history when present
3. Separate what you found into:
   - confirmed facts
   - product intent still needed from the user
   - scope or risk decisions still needed from the user
   - likely out-of-scope items
4. If a user-owned decision remains, ask the single highest-value question, include your recommendation and trade-off, then stop. Do not perform implementation work in the same turn.
5. After each user answer, update `prd.md`, recompute the decision inventory, and repeat from step 2.
6. When no user-owned decision remains, create or update `design.md` and `implement.md` for complex tasks.
   - Plan a risk-appropriate verification strategy.
   - Treat TDD as optional: prefer it for reproducible bugs, rules, state machines, algorithms, and pure logic; use contract, integration, build, runtime, log, or manual evidence where a test category is not applicable.
7. Run the requirement convergence gate, then the PRD convergence pass.
8. Present the final planning summary and stop. Do not run `task.py start` or edit product code in the same turn.
9. Only a subsequent user message that explicitly approves the latest planning summary authorizes `task.py start` and implementation. If the artifacts change materially after approval, repeat the final review.

Do not invent a project-specific product/spec hierarchy. If the repository already has product, domain, or spec docs, use them. If it does not, proceed with the evidence that exists.

## Question Rules

Ask only one question per message.

Each question must include:

- the decision needed
- why the answer matters
- your recommended answer
- the trade-off if the user chooses differently

Do not ask process questions such as whether to search, inspect files, or continue brainstorming. Do the evidence work directly. Ask the user only when the remaining issue is a product decision, preference, scope boundary, or risk tolerance choice.

Recommendations are not default selections. Never choose a recommended product decision on the user's behalf merely because the user asked for implementation.

Do not manufacture clarification questions when the request and repository evidence already resolve every decision. In that case, proceed directly to the final planning summary, which still requires a subsequent explicit approval.

The final review is a required phase-transition gate, not a prohibited process question. Task-creation consent, the initial implementation request, and approval given before the latest final summary do not satisfy this gate.

## Thinking Framework: First Principles Analysis

When requirements are vague, solutions feel over-engineered, or you're about to add complexity "because everyone does" — decompose to fundamental truths before reasoning upward.

### Step 1: Restate the Problem

Strip away implementation details to one sentence.

> Bad: "We need to add Redis caching to the user profile endpoint"
> Good: "User profile data takes too long to load"

### Step 2: List Fundamental Truths

What is absolutely true (not opinion or convention)?

| Category                 | Examples                                 |
| ------------------------ | ---------------------------------------- |
| **Physical constraints** | Network latency ≥ 0, disk I/O has limits |
| **Business rules**       | "Users must see their own data"          |
| **Technical invariants** | "Data must be consistent"                |
| **User needs**           | "The user wants X within Y seconds"      |

### Step 3: Challenge Assumptions

For each component of the current plan:

- **Fact or convention?** "We always use REST" — why?
- **What if we removed this?** If nothing breaks, it's unnecessary.
- **Solving the actual problem or a symptom?** Trace the causal chain.
- **Who benefits from this complexity?** If "nobody", simplify.

### Step 4: Build Up from Truths

1. Start with the minimum viable mechanism satisfying all truths
2. Add complexity only when a specific truth demands it
3. Each addition must answer: "Which truth requires this?"

### Step 5: Validate

- Does the solution solve the original problem?
- What assumptions need verification?
- What's the simplest experiment to test this?

## Requirement Convergence Gate

Before final review, verify all of the following:

- the user outcome and product value are explicit
- in-scope and out-of-scope behavior are explicit
- acceptance criteria describe observable outcomes
- user-owned product, scope, UX, compatibility, and risk decisions are resolved
- blocking open questions are empty
- technical unknowns are researched or explicitly deferred without changing MVP behavior

Lightweight tasks may omit `design.md` and `implement.md`; they may not skip evidence inspection, requirement convergence, final review, or fresh implementation approval.

The final planning summary must show Goal, In Scope, Out of Scope, Acceptance Criteria, Key Decisions, relevant Risks or Deferred Items, and artifact status.

## Artifact Rules

`prd.md` records requirements and acceptance:

- goal and user value
- confirmed facts
- requirements
- acceptance criteria
- out of scope
- open questions that still block planning

`design.md` records technical design for complex tasks:

- architecture and boundaries
- data flow and contracts
- compatibility and migration notes
- important trade-offs
- operational or rollback considerations

`implement.md` records execution planning for complex tasks:

- ordered implementation checklist
- validation commands
- risky files or rollback points
- follow-up checks before `task.py start`

Lightweight tasks may have only `prd.md`. Complex tasks must have `prd.md`, `design.md`, and `implement.md` before `task.py start`.

`implement.md` is not a replacement for `implement.jsonl`. On sub-agent-dispatch workflows, `implement.jsonl` and `check.jsonl` are context manifests, not implementation logs or quality-result stores. Curate the applicable role manifest before dispatching that implement/check sub-agent; a missing, empty, seed-only, or entry-invalid manifest is not ready and the dispatched agent must fail closed. `task.py start` does not choose the later execution route or enforce role-manifest readiness. Inline workflows skip only this JSONL gate because Phase 2 directly loads applicable context through `trellis-before-dev`; specs, review, and verification remain mandatory.

## PRD Convergence Pass

Before declaring planning ready or running `task.py start`, rewrite `prd.md` once against the final structure described in the artifact rules above. This is not optional cleanup; it is the final planning gate.

The pass must be lossless:

- Collapse repeated facts into one authoritative section.
- Fold temporary brainstorm sections such as `What I already know`, `Assumptions`, and resolved `Open Questions` into Goal, Background, Requirements, Technical Notes, or Acceptance Criteria.
- Remove resolved open questions instead of leaving empty or already-answered sections.
- Merge parallel bug and requirement lists when they describe the same work; keep each defect's severity, evidence, and file:line anchors on the owning requirement.
- Preserve every file:line anchor, decision, constraint, requirement ID, and acceptance-criteria mapping.
- Do not proceed to final review while any blocking open question remains.

After the pass, read `prd.md` top to bottom and verify that no fact is repeated across sections unless the repetition adds new information.

## Quality Bar

Before declaring planning ready:

- `prd.md` contains testable acceptance criteria.
- `prd.md` has passed the PRD convergence pass: no unresolved temporary brainstorm sections, no duplicate facts across sections, and no lost anchors, decisions, or acceptance mappings.
- Repository-answerable questions have already been answered through inspection.
- Blocking open questions are empty.
- Complex tasks have `design.md` and `implement.md`.
- Each planned sub-agent dispatch has a real curated entry in its applicable `implement.jsonl` or `check.jsonl` before dispatch; seed-only manifests are not ready.
- The latest final planning summary has been presented to the user.
- In a subsequent message, the user explicitly approved that summary for implementation.

Do not start implementation merely because the user originally asked for implementation.
