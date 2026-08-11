# Development Workflow

---

## Core Principles

1. **Plan before code** — figure out what to do before you start
2. **Specs injected, not remembered** — guidelines are injected via hook/skill, not recalled from memory
3. **Persist everything** — research, decisions, and lessons all go to files; conversations get compacted, files don't
4. **Incremental development** — one task at a time
5. **Capture learnings** — after each task, review and write new knowledge back to spec
6. **Natural language first** — infer intent and route automatically; commands and skills remain explicit controls, recovery paths, and capability fallbacks

---

## Trellis System

### Developer Identity

On first use, initialize your identity:

```bash
python3 ./.trellis/scripts/init_developer.py <your-name>
```

Creates `.trellis/.developer` (gitignored) + `.trellis/workspace/<your-name>/`.

### Spec System

`.trellis/spec/` holds coding guidelines organized by package and layer.

- `.trellis/spec/<package>/<layer>/index.md` — entry point with **Pre-Development Checklist** + **Quality Check**. Actual guidelines live in the `.md` files it points to.
- `.trellis/spec/guides/index.md` — cross-package thinking guides.

```bash
python3 ./.trellis/scripts/get_context.py --mode packages   # list packages / layers
```

**When to update spec**: new pattern/convention found · bug-fix prevention to codify · new technical decision.

### Task System

Every task has its own directory under `.trellis/tasks/{MM-DD-name}/` holding `task.json`, `intent.md` (the structured Task Basis), `prd.md`, optional `design.md`, optional `implement.md`, optional `research/`, and context manifests (`implement.jsonl`, `check.jsonl`) for sub-agent-capable platforms.

```bash
# Task lifecycle
python3 ./.trellis/scripts/task.py create "<title>" --classification <class> [--product-intent-link <id> | --product-intent-reason <reason>] [--slug <name>] [--parent <dir>]
python3 ./.trellis/scripts/task.py start <name>          # set active task (session-scoped when available)
python3 ./.trellis/scripts/task.py current --source      # show active task and source
python3 ./.trellis/scripts/task.py finish                # clear active task (triggers after_finish hooks)
python3 ./.trellis/scripts/task.py archive <name>        # move to archive/{year-month}/
python3 ./.trellis/scripts/task.py list [--mine] [--status <s>]
python3 ./.trellis/scripts/task.py list-archive

# Code-spec context (injected into implement/check agents via JSONL).
# `implement.jsonl` / `check.jsonl` are seeded on `task create` for sub-agent-capable
# platforms; the AI curates real spec + research entries during planning when needed.
python3 ./.trellis/scripts/task.py add-context <name> <action> <file> <reason>
python3 ./.trellis/scripts/task.py list-context <name> [action]
python3 ./.trellis/scripts/task.py validate <name>

# Task metadata
python3 ./.trellis/scripts/task.py set-branch <name> <branch>
python3 ./.trellis/scripts/task.py set-base-branch <name> <branch>    # PR target
python3 ./.trellis/scripts/task.py set-scope <name> <scope>

# Hierarchy (parent/child)
python3 ./.trellis/scripts/task.py add-subtask <parent> <child>
python3 ./.trellis/scripts/task.py remove-subtask <parent> <child>

# PR creation
python3 ./.trellis/scripts/task.py create-pr [name] [--dry-run]
```

> Run `python3 ./.trellis/scripts/task.py --help` to see the authoritative, up-to-date list.

**Current-task mechanism**: `task.py create` creates the task directory and (when session identity is available) auto-sets the per-session active-task pointer so the planning breadcrumb fires immediately. `task.py start` writes the same pointer (idempotent if already set) and flips `task.json.status` from `planning` to `in_progress`. State is stored under `.trellis/.runtime/sessions/`. If no context key is available from hook input, `TRELLIS_CONTEXT_ID`, or a platform-native session environment variable, there is no active task and `task.py start` fails with a session identity hint. `task.py finish` deletes the current session file (status unchanged). `task.py archive <task>` writes `status=completed`, moves the directory to `archive/`, and deletes any runtime session files that still point at the archived task.

### Workspace System

Records every AI session for cross-session tracking under `.trellis/workspace/<developer>/`.

- `journal-N.md` — session log. **Max 2000 lines per file**; a new `journal-(N+1).md` is auto-created when exceeded.
- `index.md` — personal index (total sessions, last active).

```bash
python3 ./.trellis/scripts/add_session.py --title "Title" --commit "hash" --summary "Summary"
```

### Context Script

```bash
python3 ./.trellis/scripts/get_context.py                            # full session runtime
python3 ./.trellis/scripts/get_context.py --mode packages            # available packages + spec layers
python3 ./.trellis/scripts/get_context.py --mode phase --step <X.Y>  # detailed guide for a workflow step
```

---

<!--
  WORKFLOW-STATE BREADCRUMB CONTRACT (read this before editing the tag blocks below)

  The [workflow-state:STATUS] blocks embedded in the ## Phase Index section
  below are the SINGLE source of truth for the per-turn `<workflow-state>`
  breadcrumb that every supported AI platform's UserPromptSubmit hook
  reads. inject-workflow-state.py (Python platforms) and
  inject-workflow-state.js (OpenCode plugin) only parse them — there is no
  fallback dict baked into the scripts after v0.5.0-rc.0.

  STATUS charset: [A-Za-z0-9_-]+. When the hook can't find a tag, it
  degrades to a generic "Refer to workflow.md for current step." line —
  intentionally visible so users notice and fix a broken workflow.md.

  INVARIANT (test/regression.test.ts):
    Every workflow-walkthrough step marked `[required · once]` must have a
    matching enforcement line in its phase's [workflow-state:*] block. The
    breadcrumb is the only per-turn channel; if a mandatory step isn't
    mentioned there, the AI silently skips it (Phase 1 planning gate
    skip and Phase 3.4 commit skip both manifested via this gap).

  TAG ↔ PHASE scoping:
    [workflow-state:no_task]      → no active task; before Phase 1
    [workflow-state:planning]     → all of Phase 1 (status='planning')
    [workflow-state:planning-inline] → Codex inline variant of Phase 1
    [workflow-state:in_progress]  → Phase 2 + Phase 3.2-3.4
                                    (status stays 'in_progress' from
                                    task.py start until task.py archive)
    [workflow-state:in_progress-inline] → Codex inline variant of Phase 2/3
    [workflow-state:completed]    → currently DEAD: cmd_archive flips
                                    status and moves the dir in the same
                                    call, so the resolver loses the
                                    pointer (block kept for a future
                                    explicit in_progress→completed
                                    transition)

  Editing checklist:
    - When you change a [workflow-state:STATUS] block, also check the
      matching phase's `[required · once]` walkthrough steps for sync
    - Run `trellis update` after editing to push the new bodies to
      downstream user projects (block-level managed replacement)
    - Full runtime contract:
      .trellis/spec/cli/backend/workflow-state-contract.md
-->

## Phase Index

```
Phase 1: Plan    → classify, get task-creation consent, then write planning artifacts
Phase 2: Execute → implement only after task status is in_progress
Phase 3: Finish  → verify, update spec, commit, and wrap up
```

### Request Triage

- Read-only questions, explanations, reviews, and status checks do not create a development task. Inspect and answer with evidence.
- Ordinary operational work usually does not create a development task. Execute within the user's authority and use a task only when the operation itself needs durable planning, review, or rollback coordination.
- Business features, bug fixes, refactors, and maintenance changes enter planning according to their scope and risk. Ask for task-creation consent before creating a Trellis task.
- Review revisions reuse the existing task and MR/PR context instead of creating a duplicate task.
- Natural-language intent is the default entry point. Do not require the user to remember or execute a fixed `/trellis:*` command chain.
- Explicit commands and skills are for standalone operations, recovery, correction, advanced control, or capability fallback when automatic routing is unavailable.
- If a user declines a task for broad development work, explain the planning risk, clarify scope, or suggest a smaller independently safe change.
- User approval to create a task is not approval to start implementation. Planning still happens first.

### Dazz Constraint Voice

Dazz is a presentation layer for Trellis-owned reminders, teaching, corrections, and hard stops. Executable classification, Task Basis, task-state, approval, manifest, and spec-loading checks remain the source of governance facts; the voice never changes their result.

- Use a light, protective teaching tone for reminders, a direct correction for strong constraints, and a clear stop for hard gates.
- For a hard gate, make the first user-facing sentence Dazz's direct fatherly correction and follow it with the single concrete action that can unblock progress. Recommend the safe default when one exists.
- Keep ordinary research, progress, and quality reporting natural. Do not force Dazz into every response.
- Preserve third-party and team-governance voices.
- Apply Dazz to the classified rule that failed: business features require approved Product Intent; eligible bugfix/maintenance work requires a complete Task Basis with a concrete `NOT_REQUIRED` reason; planning needs fresh start approval; implementation needs applicable specs. Never recreate a blanket Product Intent requirement.
- Readonly and ordinary operational work remain outside development gates.

Example: `先停下。Dazz 不会让你在 Product Intent 还没批准时直接创建业务功能任务。先补齐已批准的链接，我再带你把 Task Basis 立起来。`

### Planning Artifacts

- `intent.md` — structured Task Basis: request classification, Product Intent link or reasoned `NOT_REQUIRED`, requested outcome, scope boundary, and acceptance / verification basis. The compatibility filename does not make it a blanket Product Intent requirement.
- `prd.md` — requirements, constraints, and acceptance criteria. Do not put technical design or execution checklists here.
- `design.md` — technical design for complex tasks: boundaries, contracts, data flow, tradeoffs, compatibility, rollout / rollback shape.
- `implement.md` — execution plan for complex tasks: ordered checklist, validation commands, review gates, and rollback points.
- `implement.jsonl` / `check.jsonl` — spec and research manifests for sub-agent context. They are not activity logs, implementation journals, or quality-result stores, and they do not replace `implement.md`.
- Lightweight tasks may be PRD-only. Complex tasks must have `prd.md`, `design.md`, and `implement.md` before `task.py start`.

### Testing Strategy

Intent-first planning and specification-driven development define the workflow skeleton. TDD is an optional implementation strategy selected by risk and testability, not a mandatory phase for every change.

- Prefer TDD when behavior is reproducible and can be expressed before implementation, especially for bug regressions, business rules, state machines, algorithms, and pure logic.
- Configuration, device-dependent behavior, cross-system integration, and legacy seams may need contract tests, integration checks, builds, runtime probes, logs, or explicit manual verification instead.
- A test category being unavailable or not applicable is not evidence that the change is correct. Record the reason and provide proportionate alternative verification evidence.

### Quality Evidence Contract

Use one shared contract for local iteration and merge-request readiness. Platform-specific executors such as GitLab pipelines and Sonar remain external implementations; Trellis consumes their facts without duplicating or manufacturing them.

**Profiles**:

- `ITERATION` — working feedback for the current worktree and dirty change scope.
- `MR_CANDIDATE` — release-quality evidence for an exact source SHA against an exact fetched target SHA and the complete candidate diff.

**Statuses**: `PASSED`, `FAILED`, `NOT_CONFIGURED`, `NOT_APPLICABLE`, `SKIPPED`, `PENDING`, `UNKNOWN`, `PLANNED`.

**Identity**:

- `ITERATION`: worktree, HEAD when applicable, and the dirty diff/change scope checked.
- `MR_CANDIDATE`: HEAD/source SHA, fetched target SHA, and the complete candidate diff checked.

**Evidence** records the command or observation, status, checked object, key result, time, and source. An exit code of zero alone does not prove that tests were discovered or executed.

**Invalidation**: code, dirty diff, HEAD, target SHA, relevant configuration, or execution-environment changes invalidate affected prior evidence. Re-run or explicitly mark the evidence stale.

**Fail closed**:

- Required facts at `FAILED`, `UNKNOWN`, or `PENDING` cannot support an MR-ready claim.
- `NOT_APPLICABLE` and `SKIPPED` require a reason and, where relevant, alternative evidence.
- Do not change Sonar, pipeline, or platform facts merely to manufacture a passing result.
- `check.jsonl` names context to load; never write verification results into it.

### Parent / Child Task Trees

Use a parent task when one user request contains several independently verifiable deliverables. The parent task owns the source requirement set, the task map, cross-child acceptance criteria, and final integration review; it normally should not be the implementation target unless it also has direct work.

Use child tasks for deliverables that can be planned, implemented, checked, and archived independently. Parent/child structure is not a dependency system: if one child must wait for another, write that ordering in the child `prd.md` / `implement.md` and keep each child's acceptance criteria testable.

Every parent and child owns its own classification and Task Basis. For example, create a maintenance child with `task.py create "<title>" --slug <name> --parent <parent-dir> --classification maintenance --product-intent-reason "<why Product Intent is not required>"`; use `--classification business-feature --product-intent-link "<approved intent URL or document id>"` for a business-feature child. Link existing tasks with `task.py add-subtask <parent> <child>`, and unlink mistakes with `task.py remove-subtask <parent> <child>`.

<!-- Per-turn breadcrumb: shown when there is no active task (before Phase 1) -->

[workflow-state:no_task]
No active task. Classify the natural-language request before deciding whether a Trellis task is needed.
Read-only or ordinary operational work: proceed without a development task unless durable planning/review is genuinely needed.
Feature, bug-fix, refactor, or maintenance development: ask for task-creation consent before creating a task. If declined for broad work, explain the risk, clarify scope, or suggest a smaller split.
For a Trellis-owned hard gate, use Dazz's direct correction first and give the one concrete next action; apply the classified Task Basis rule, never a blanket Product Intent gate.
Do not require a fixed command chain; explicit commands/skills are standalone controls, recovery/correction paths, or capability fallbacks.
[/workflow-state:no_task]

### Phase 1: Plan

- 1.0 Create task `[required · once]` (only after task-creation consent)
- 1.1 Requirement exploration `[required · repeatable]` (`prd.md`; complex tasks also need `design.md` + `implement.md`)
- 1.2 Research `[optional · repeatable]`
- 1.3 Configure context `[required · once]` — Claude Code, Cursor, OpenCode, Codex, Kiro, Gemini, Qoder, CodeBuddy, Copilot, Droid, Pi, Oh My Pi, ZCode, Snow, Reasonix, Trae, Grok, Kimi Code (sub-agent-dispatch platforms only; inline platforms skip)
- 1.4 Activate task `[required · once]` (review gate, then `task.py start`; status → in_progress)
- 1.5 Completion criteria

<!-- Per-turn breadcrumb: shown throughout Phase 1 (status='planning') -->

[workflow-state:planning]
Load `trellis-brainstorm`; stay in planning.
Lightweight: `prd.md` can be enough. Complex: finish `prd.md`, `design.md`, and `implement.md`; ask for review before `task.py start`.
Multi-deliverable scope: consider a parent task plus independently verifiable child tasks; dependencies must be written in child artifacts, not implied by tree position.
Sub-agent mode: curate each applicable `implement.jsonl` or `check.jsonl` spec/research manifest before that implement/check dispatch.
If a Trellis-owned approval or Task Basis gate blocks the transition, use Dazz's direct correction and give the single concrete action needed; keep normal planning updates natural.
[/workflow-state:planning]

<!-- Per-turn breadcrumb: shown throughout Phase 1 when codex.dispatch_mode=inline.
     Codex-only opt-in alternate to [workflow-state:planning]. The main agent
     edits code directly in Phase 2, so jsonl curation is skipped —
     the inline workflow loads `trellis-before-dev` instead of injecting JSONL
     into a sub-agent. -->

[workflow-state:planning-inline]
Load `trellis-brainstorm`; stay in planning.
Lightweight: `prd.md` can be enough. Complex: finish `prd.md`, `design.md`, and `implement.md`; ask for review before `task.py start`.
Multi-deliverable scope: consider a parent task plus independently verifiable child tasks; dependencies must be written in child artifacts, not implied by tree position.
Inline mode: skip jsonl curation only; Phase 2 must load applicable specs via `trellis-before-dev` and still perform risk-appropriate verification.
If a Trellis-owned approval or Task Basis gate blocks the transition, use Dazz's direct correction and give the single concrete action needed; keep normal planning updates natural.
[/workflow-state:planning-inline]

### Phase 2: Execute

- 2.1 Implement `[required · repeatable]`
- 2.2 Quality check `[required · repeatable]`
- 2.3 Rollback `[on demand]`

<!-- Per-turn breadcrumb: shown while status='in_progress'.
     Scope: all of Phase 2 + Phase 3.2-3.4 (status stays 'in_progress' from
     task.py start until task.py archive; only archive flips it). The body
     therefore must cover every required step from implementation through
     commit, including Phase 3.3 spec update and Phase 3.4 commit. -->

Sub-agent dispatch protocol applies to all platforms and all sub-agents, including native Codex `SubagentStart` context injection with child-side pull fallback, class-2 Gemini/Qoder/Copilot/Reasonix/Trae/Grok/Kimi Code, hook-backed ZCode/Snow, and `trellis-research`: every dispatch prompt starts with `Active task: <task path from task.py current>` before role-specific instructions. An implement/check sub-agent must fail closed when its corresponding manifest is missing, empty, seed-only, or has no valid `file` entry: report the manifest problem to the main session and do not begin implementation/check. On Grok Build, use `spawn_subagent` with `subagent_type` set to the Trellis agent name (e.g. `trellis-implement`). On Kimi Code, dispatch the built-in `coder` / `explore` sub-agent with the matching `.kimi-code/skills/trellis-<role>/SKILL.md` instructions.

[workflow-state:in_progress]
Tools: `trellis-implement` / `trellis-research` are sub-agent types only (Task/Agent tool, NOT Skill; there is no skill by these names). `trellis-update-spec` is a skill. `trellis-check` exists as both; prefer the Agent form when verifying after code changes.
Flow: `trellis-implement` -> `trellis-check` -> `trellis-update-spec` -> commit (Phase 3.4) -> completion through the active workflow and host. An explicit `/trellis:finish-work` invocation is a recovery/platform fallback, not a required user step.
Main-session default: dispatch implement/check sub-agents. Sub-agent self-exemption: if already running as `trellis-implement`, do NOT spawn another `trellis-implement` or `trellis-check`; if already running as `trellis-check`, do NOT spawn another `trellis-check` or `trellis-implement`. Dispatch is main session only.
Before an implement/check spawn, the main session MUST run `python3 ./.trellis/scripts/task.py validate-role-context "<task-path>" implement` or `python3 ./.trellis/scripts/task.py validate-role-context "<task-path>" check` for that role and spawn only after exit 0. The spawned role reruns the same command as defense in depth; child-side validation does not replace this caller-side gate.
Dispatch prompt starts with `Active task: <task path from task.py current>`. Read context: jsonl entries -> `prd.md` -> `design.md if present` -> `implement.md if present`.
Fail closed before work if the role's jsonl manifest is missing, empty, seed-only, or contains no valid `file` entry; report what the main session must curate.
For a Trellis-owned manifest/spec hard stop, the main session explains it with Dazz's direct correction plus the single concrete fix; ordinary implementation and check reporting stays natural.
[/workflow-state:in_progress]

<!-- Per-turn breadcrumb: shown while status='in_progress' when
     codex.dispatch_mode=inline. Codex-only opt-in alternate to
     [workflow-state:in_progress]. The main session edits code directly
     instead of dispatching sub-agents. -->

[workflow-state:in_progress-inline]
Flow: `trellis-before-dev` -> edit -> `trellis-check` -> validation -> `trellis-update-spec` -> commit (Phase 3.4) -> completion through the active workflow and host. An explicit `/trellis:finish-work` invocation is a recovery/platform fallback, not a required user step.
Do not dispatch implement/check sub-agents in inline mode.
Read context: `prd.md` -> `design.md if present` -> `implement.md if present`, plus applicable spec/research loaded by skills. Skipping jsonl does not skip specs, review, or risk-appropriate verification.
For a Trellis-owned task/spec hard stop, use Dazz's direct correction plus the single concrete fix; ordinary implementation and check reporting stays natural.
[/workflow-state:in_progress-inline]

### Phase 3: Finish

- 3.2 Debug retrospective `[on demand]`
- 3.3 Spec update `[required · once]`
- 3.4 Commit changes `[required · once]`
- 3.5 Wrap-up reminder

> Note: step 3.1 was folded into 2.2 (last-iteration full-scope check) and 3.4 (commit preamble). Numbering kept stable to avoid breaking external references.

<!-- Per-turn breadcrumb: shown while status='completed'.
     Currently DEAD in normal flow: cmd_archive writes status='completed' in
     the same call that moves the task dir to archive/, so the active-task
     resolver loses the pointer and the hook never fires on archived tasks.
     Block preserved for a future status-transition redesign (e.g. an
     explicit in_progress→completed command). Edit through the same spec
     channel as the live blocks. -->

[workflow-state:completed]
Code committed. Complete wrap-up through the active workflow and host; use `/trellis:finish-work` only as an explicit recovery/platform fallback. If dirty, return to Phase 3.4 first.
[/workflow-state:completed]

### Rules

1. Identify which Phase you're in, then continue from the next step there
2. Run steps in order inside each Phase; `[required]` steps can't be skipped
3. Phases can roll back (e.g., Execute reveals a prd defect → return to Plan to fix, then re-enter Execute)
4. Steps tagged `[once]` are skipped if the output already exists; don't re-run
5. Artifact presence informs the next step; missing `design.md` / `implement.md` is valid for lightweight tasks and incomplete planning for complex tasks.

### Active Task Routing

When a user request matches one of these intents inside an active task, route first, then load the detailed phase step if needed.

[Claude Code, Cursor, OpenCode, codex-sub-agent, Kiro, Gemini, Qoder, CodeBuddy, Copilot, Droid, Pi, Oh My Pi, ZCode, Snow, Reasonix, Trae, Grok, Kimi Code]

- Natural-language development request with planning or unclear requirements -> `trellis-brainstorm`.
- `in_progress` implementation/check -> dispatch `trellis-implement` / `trellis-check`.
- Repeated debugging -> `trellis-break-loop`; spec updates -> `trellis-update-spec`.
- Explicit commands/skills remain available for standalone operations, recovery, correction, advanced control, or platform capability fallback; they are not a required daily command chain.

[/Claude Code, Cursor, OpenCode, codex-sub-agent, Kiro, Gemini, Qoder, CodeBuddy, Copilot, Droid, Pi, Oh My Pi, ZCode, Snow, Reasonix, Trae, Grok, Kimi Code]

[codex-inline, Kilo, Antigravity, Devin]

- Planning or unclear requirements -> `trellis-brainstorm`.
- Before editing -> `trellis-before-dev`; after editing -> `trellis-check`.
- Repeated debugging -> `trellis-break-loop`; spec updates -> `trellis-update-spec`.

[/codex-inline, Kilo, Antigravity, Devin]

### Guardrails

- Task creation approval is not implementation approval; implementation waits for `task.py start` after artifact review.
- PRD-only is valid for lightweight tasks; complex tasks need `design.md` + `implement.md`.
- Planning must be persisted to task artifacts; checks must run before reporting completion.

### Loading Step Detail

At each step, run this to fetch detailed guidance:

```bash
python3 ./.trellis/scripts/get_context.py --mode phase --step <step>
# e.g. python3 ./.trellis/scripts/get_context.py --mode phase --step 1.1
```

---

## Phase 1: Plan

Goal: classify the request, get task-creation consent when a task is needed, and produce the planning artifacts required before implementation.

#### 1.0 Create task `[required · once]`

Create the task directory only after task-creation consent. The command sets status to `planning`, writes `task.json`, creates `intent.md` as the structured Task Basis plus a default `prd.md`, and auto-targets the new task when session identity is available. Pass the classification and its Product Intent basis in the same command so the default governance gate can validate task creation:

```bash
# Approved business feature
python3 ./.trellis/scripts/task.py create "<task title>" --slug <name> --classification business-feature --product-intent-link "<approved intent URL or document id>"

# Bug fix or maintenance work (choose the matching classification)
python3 ./.trellis/scripts/task.py create "<task title>" --slug <name> --classification maintenance --product-intent-reason "<concrete reason Product Intent is not required>"
```

`--slug` is the human-readable name only. Do **not** include the `MM-DD-` date prefix; `task.py create` adds that prefix automatically.

Use `--classification bugfix` instead of `maintenance` for a bug fix. Review revisions normally reuse the existing task and MR/PR evidence; if an exceptional standalone review-revision task is justified, its Task Basis must reuse the applicable Product Intent link or record a concrete `NOT_REQUIRED` reason. Readonly and ordinary operational work do not use `task.py create`.

For task trees, create the parent task first and then create each child with `--parent <parent-dir>`. Pass `--classification` and the applicable `--product-intent-link` or `--product-intent-reason` for every parent and child; tree position never supplies a Task Basis. Do not start the parent just because children exist; start the child that owns the next independently verifiable deliverable.

After this command succeeds, the per-turn breadcrumb auto-switches to `[workflow-state:planning]`, telling the AI to stay in planning.

Run only `create` here — do not also run `start`. `start` flips status to `in_progress`, which switches the breadcrumb to the implementation phase before planning artifacts are reviewed. Save `start` for step 1.4.

Skip when `python3 ./.trellis/scripts/task.py current --source` already points to a task.

#### 1.1 Requirement exploration `[required · repeatable]`

Load the `trellis-brainstorm` skill and explore requirements interactively with the user per the skill's guidance.

The brainstorm skill will guide you to:

- Ask one question at a time
- Prefer researching over asking the user
- Prefer offering options over open-ended questions
- Complete `intent.md` as the Task Basis: confirm classification, Product Intent link or reasoned `NOT_REQUIRED`, requested outcome, scope boundary, and acceptance / verification basis
- Update `prd.md` immediately after each user answer
- Split large scopes into a parent task plus child tasks when the deliverables can be verified independently
- Keep `prd.md` focused on requirements and acceptance criteria
- For complex tasks, produce `design.md` and `implement.md` before implementation starts

When considering a parent/child split:

- Use a parent task when one request contains several independently verifiable deliverables.
- Parent tasks own source requirements, child-task mapping, cross-child acceptance criteria, and final integration review.
- Child tasks own actual deliverables that can be planned, implemented, checked, and archived independently.
- Parent/child structure is not a dependency system. If child B depends on child A, write that ordering in child B's `prd.md` / `implement.md`.
- Start the child task that owns the next deliverable. Do not start the parent unless the parent itself has direct implementation work.

Return to this step whenever requirements change and revise the relevant artifact.

#### 1.2 Research `[optional · repeatable]`

Research can happen at any time during requirement exploration. It isn't limited to local code — you can use any available tool (MCP servers, skills, web search, etc.) to look up external information, including third-party library docs, industry practices, API references, etc.

[Claude Code, Cursor, OpenCode, codex-sub-agent, Kiro, Gemini, Qoder, CodeBuddy, Copilot, Droid, Pi, Oh My Pi, ZCode, Snow, Reasonix, Trae, Grok, Kimi Code]

Spawn the research sub-agent:

- **Agent type**: `trellis-research`
- **Task description**: Research <specific question>
- **Key requirement**: Research output MUST be persisted to `{TASK_DIR}/research/`

[/Claude Code, Cursor, OpenCode, codex-sub-agent, Kiro, Gemini, Qoder, CodeBuddy, Copilot, Droid, Pi, Oh My Pi, ZCode, Snow, Reasonix, Trae, Grok, Kimi Code]

[codex-inline, Kilo, Antigravity, Devin]

Do the research in the main session directly and write findings into `{TASK_DIR}/research/`. `codex-inline` is the explicit mode that keeps work in the main session.

[/codex-inline, Kilo, Antigravity, Devin]

**Research artifact conventions**:

- One file per research topic (e.g. `research/auth-library-comparison.md`)
- Record third-party library usage examples, API references, version constraints in files
- Note relevant spec file paths you discovered for later reference

Brainstorm and research can interleave freely — pause to research a technical question, then return to talk with the user.

**Key principle**: Research output must be written to files, not left only in the chat. Conversations get compacted; files don't.

#### 1.3 Configure context `[required · once]`

[Claude Code, Cursor, OpenCode, codex-sub-agent, Kiro, Gemini, Qoder, CodeBuddy, Copilot, Droid, Pi, Oh My Pi, ZCode, Snow, Reasonix, Trae, Grok, Kimi Code]

Curate `implement.jsonl` and `check.jsonl` so the Phase 2 sub-agents get the right spec/research context. These files were seeded on `task create` with a single self-describing `_example` line; your job here is to fill in real entries.

**Location**: `{TASK_DIR}/implement.jsonl` and `{TASK_DIR}/check.jsonl` (already exist).

**Format**: one JSON object per line — `{"file": "<path>", "reason": "<why>"}`. Paths are repo-root relative.

**What to put in**:

- **Spec files** — `.trellis/spec/<package>/<layer>/index.md` and any specific guideline files (`error-handling.md`, `conventions.md`, etc.) relevant to this task
- **Research files** — `{TASK_DIR}/research/*.md` that the sub-agent will need to consult

**What NOT to put in**:

- Code files (`src/**`, `packages/**/*.ts`, etc.) — those are read by the sub-agent during implementation, not pre-registered here
- Files you're about to modify — same reason

**Split between the two files**:

- `implement.jsonl` → specs + research the implement sub-agent needs to write code correctly
- `check.jsonl` → specs for the check sub-agent (quality guidelines, check conventions, same research if needed)

These manifests do not replace `implement.md`. `implement.md` is the human-readable execution plan for a complex task; jsonl files only list context files to inject or load.

They are manifests, not logs: do not append implementation progress, command output, test results, review findings, or pass/fail evidence. In particular, `check.jsonl` must never be used as a quality-result store.

**How to discover relevant specs**:

```bash
python3 ./.trellis/scripts/get_context.py --mode packages
```

Lists every package + its spec layers with paths. Pick the entries that match this task's domain.

**How to append entries**:

Either edit the jsonl file directly in your editor, or use:

```bash
python3 ./.trellis/scripts/task.py add-context "$TASK_DIR" implement "<path>" "<reason>"
python3 ./.trellis/scripts/task.py add-context "$TASK_DIR" check "<path>" "<reason>"
```

Delete the seed `_example` line once real entries exist (optional — it's skipped automatically by consumers).

Dispatch gate: curate the applicable `implement.jsonl` or `check.jsonl` with at least one real `{"file": "...", "reason": "..."}` entry before dispatching that role. A missing, empty, seed-only, or entry-invalid manifest is not ready. The main session's role-specific `validate-role-context` command is the authoritative pre-spawn gate: run it for the applicable role and spawn only after it exits 0. The dispatched role reruns the same validation only as defense in depth; `task.py start` does not infer a later dispatch route.

Skip manifest edits only when no implement/check sub-agent dispatch is planned yet or each role about to be dispatched already has a real curated entry. The main session checks JSONL readiness before spawn; the child rechecks only as defense in depth. Neither check belongs to `task.py start`.

[/Claude Code, Cursor, OpenCode, codex-sub-agent, Kiro, Gemini, Qoder, CodeBuddy, Copilot, Droid, Pi, Oh My Pi, ZCode, Snow, Reasonix, Trae, Grok, Kimi Code]

[codex-inline, Kilo, Antigravity, Devin]

Skip jsonl curation only. Context is loaded directly by the `trellis-before-dev` skill in Phase 2, which must load every applicable spec; review and verification remain required.

[/codex-inline, Kilo, Antigravity, Devin]

#### 1.4 Activate task `[required · once]`

After artifact review, flip the task status to `in_progress`:

```bash
python3 ./.trellis/scripts/task.py start <task-dir>
```

For lightweight tasks, `prd.md` can be enough. For complex tasks, `prd.md`, `design.md`, and `implement.md` must exist and be reviewed before start. JSONL readiness follows actual dispatch: before an implement/check sub-agent begins role work, its applicable manifest must have real curated entries. Missing, empty, seed-only, or invalid manifests are not tolerated by the dispatched role, while deliberate inline execution remains manifest-independent and loads applicable specs directly.

After this command succeeds, the breadcrumb auto-switches to `[workflow-state:in_progress]`, and the rest of Phase 2 / 3 follows.

If `task.py start` errors with a session-identity message (no context key from hook input, `TRELLIS_CONTEXT_ID`, or platform-native session env), follow the hint in the error to set up session identity, then retry.

#### 1.5 Completion criteria

| Condition                                             |  Required   |
| ----------------------------------------------------- | :---------: |
| `intent.md` contains a complete classified Task Basis |     ✅      |
| `prd.md` exists                                       |     ✅      |
| User confirms task should enter implementation        |     ✅      |
| `task.py start` has been run (status = in_progress)   |     ✅      |
| `research/` has artifacts (complex tasks)             | recommended |
| `design.md` exists (complex tasks)                    |     ✅      |
| `implement.md` exists (complex tasks)                 |     ✅      |

[Claude Code, Cursor, OpenCode, codex-sub-agent, Kiro, Gemini, Qoder, CodeBuddy, Copilot, Droid, Pi, Oh My Pi, ZCode, Snow, Reasonix, Trae, Grok, Kimi Code]

| Each applicable role manifest contains at least one real curated entry before its implement/check dispatch (seed row does not count) | ✅ at dispatch |

[/Claude Code, Cursor, OpenCode, codex-sub-agent, Kiro, Gemini, Qoder, CodeBuddy, Copilot, Droid, Pi, Oh My Pi, ZCode, Snow, Reasonix, Trae, Grok, Kimi Code]

---

## Phase 2: Execute

Goal: turn reviewed planning artifacts into code that passes quality checks.

#### 2.1 Implement `[required · repeatable]`

[Claude Code, Cursor, OpenCode, codex-sub-agent, Kiro, Gemini, Qoder, CodeBuddy, Copilot, Droid, Pi, Oh My Pi, ZCode, Snow, Reasonix, Trae, Grok, Kimi Code]

Before spawning, the main session MUST run this caller-side gate with the active task path:

```bash
python3 ./.trellis/scripts/task.py validate-role-context "<task-path>" implement
```

Spawn `trellis-implement` only after the command exits 0. If it fails, stop, report the exact manifest/path problem, curate `implement.jsonl`, and rerun the gate; do not spawn. The spawned role reruns the same command as defense in depth, which does not replace this caller-side gate.

[/Claude Code, Cursor, OpenCode, codex-sub-agent, Kiro, Gemini, Qoder, CodeBuddy, Copilot, Droid, Pi, Oh My Pi, ZCode, Snow, Reasonix, Trae, Grok, Kimi Code]

[Claude Code, Cursor, OpenCode, codex-sub-agent, CodeBuddy, Droid, Pi, ZCode, Snow, Oh My Pi]

Spawn the implement sub-agent:

- **Agent type**: `trellis-implement`
- **Task description**: Implement the reviewed task artifacts, consulting materials under `{TASK_DIR}/research/`; finish by running project lint and type-check
- **Dispatch prompt guard**: The prompt MUST start with `Active task: <task path>`, then tell the spawned agent it is already the `trellis-implement` sub-agent and must implement directly, not spawn another `trellis-implement` / `trellis-check`.

The platform hook/plugin auto-handles:

- Reads `implement.jsonl` and injects referenced spec/research files into the agent prompt
- Injects `prd.md`, `design.md` if present, and `implement.md` if present
- For Codex, `SubagentStart` supplies native context injection; the agent profile keeps child-side loading as the fallback
- If curated manifest context is absent or invalid, the agent reports the gap and does not implement

[/Claude Code, Cursor, OpenCode, codex-sub-agent, CodeBuddy, Droid, Pi, ZCode, Snow, Oh My Pi]

[Gemini, Qoder, Copilot, Reasonix, Trae, Grok, Kimi Code]

Spawn the implement sub-agent:

- **Agent type**: `trellis-implement`
- **Task description**: Implement the reviewed task artifacts, consulting materials under `{TASK_DIR}/research/`; finish by running project lint and type-check
- **Dispatch prompt guard**: The prompt MUST start with `Active task: <task path>`, then explicitly say the spawned agent is already `trellis-implement` and must implement directly without spawning another `trellis-implement` / `trellis-check`.

The pull-based sub-agent definition auto-handles the context load requirement:

- Resolves the active task with `task.py current --source`, then reads `prd.md`, `design.md` if present, and `implement.md` if present
- Reads `implement.jsonl` and requires the agent to load each referenced spec/research file before coding
- Stops before coding when `implement.jsonl` is missing, empty, seed-only, or has no valid `file` entry

[/Gemini, Qoder, Copilot, Reasonix, Trae, Grok, Kimi Code]

[Kiro]

Spawn the implement sub-agent:

- **Agent type**: `trellis-implement`
- **Task description**: Implement the reviewed task artifacts, consulting materials under `{TASK_DIR}/research/`; finish by running project lint and type-check
- **Dispatch prompt guard**: Tell the spawned agent it is already the `trellis-implement` sub-agent and must implement directly, not spawn another `trellis-implement` / `trellis-check`.

The platform prelude auto-handles the context load requirement:

- Reads `implement.jsonl` and injects referenced spec/research files into the agent prompt
- Injects `prd.md`, `design.md` if present, and `implement.md` if present
- If curated manifest context is absent or invalid, the agent reports the gap and does not implement

[/Kiro]

[codex-inline, Kilo, Antigravity, Devin]

1. Load the `trellis-before-dev` skill to read project guidelines
2. Read `{TASK_DIR}/prd.md`, then `design.md` if present, then `implement.md` if present
3. Consult materials under `{TASK_DIR}/research/`
4. Implement the code per reviewed artifacts
5. Run project lint and type-check

Inline mode intentionally has no jsonl gate. It does not waive direct loading of applicable specs or risk-appropriate verification.

[/codex-inline, Kilo, Antigravity, Devin]

#### 2.2 Quality check `[required · repeatable]`

[Claude Code, Cursor, OpenCode, codex-sub-agent, Kiro, Gemini, Qoder, CodeBuddy, Copilot, Droid, Pi, Oh My Pi, ZCode, Snow, Reasonix, Trae, Grok, Kimi Code]

Before spawning, the main session MUST run this caller-side gate with the active task path:

```bash
python3 ./.trellis/scripts/task.py validate-role-context "<task-path>" check
```

Spawn `trellis-check` only after the command exits 0. If it fails, stop, report the exact manifest/path problem, curate `check.jsonl`, and rerun the gate; do not spawn. The spawned role reruns the same command as defense in depth, which does not replace this caller-side gate.

Spawn the check sub-agent:

- **Agent type**: `trellis-check`
- **Task description**: Review all code changes against specs and task artifacts; fix any findings directly; ensure lint and type-check pass
- **Dispatch prompt guard**: The prompt MUST start with `Active task: <task path>`, then tell the spawned agent it is already the `trellis-check` sub-agent and must review/fix directly, not spawn another `trellis-check` / `trellis-implement`.

The check agent's job:

- Review code changes against specs
- Review code changes against `prd.md`, `design.md` if present, and `implement.md` if present
- Auto-fix issues it finds
- Run risk-appropriate checks and report `ITERATION` evidence with identity, status, and invalidation limits
- Stop and report to the main session when `check.jsonl` is missing, empty, seed-only, or has no valid `file` entry

[/Claude Code, Cursor, OpenCode, codex-sub-agent, Kiro, Gemini, Qoder, CodeBuddy, Copilot, Droid, Pi, Oh My Pi, ZCode, Snow, Reasonix, Trae, Grok, Kimi Code]

[codex-inline, Kilo, Antigravity, Devin]

Load the `trellis-check` skill and verify the code per its guidance:

- Spec compliance
- lint / type-check / tests
- Cross-layer consistency (when changes span layers)
- `ITERATION` identity, statuses, evidence, and invalidation

If issues are found → fix → re-check, until green.

[/codex-inline, Kilo, Antigravity, Devin]

**Final pass (before Phase 3.4 commit)**: the last 2.2 of a task must run full-scope, not just on the latest implement chunk. List all affected packages with `python3 ./.trellis/scripts/get_context.py --mode packages`, then load each package's spec index Quality Check section. This catches cross-layer / multi-package issues a mid-iteration local 2.2 cannot.

#### 2.3 Rollback `[on demand]`

- `check` reveals a prd defect → return to Phase 1, fix `prd.md`, then redo 2.1
- Implementation went wrong → revert code, redo 2.1
- Need more research → research (same as Phase 1.2), write findings into `research/`

---

## Phase 3: Finish

Goal: ensure code quality, capture lessons, record the work.

#### 3.2 Debug retrospective `[on demand]`

If this task involved repeated debugging (the same issue was fixed multiple times), load the `trellis-break-loop` skill to:

- Classify the root cause
- Explain why earlier fixes failed
- Propose prevention

The goal is to capture debugging lessons so the same class of issue doesn't recur.

#### 3.3 Spec update `[required · once]`

Load the `trellis-update-spec` skill and review whether this task produced new knowledge worth recording:

- Newly discovered patterns or conventions
- Pitfalls you hit
- New technical decisions

Update the docs under `.trellis/spec/` accordingly. Even if the conclusion is "nothing to update", walk through the judgment.

#### 3.4 Commit changes `[required · once]`

**Spec-sync preamble**: before drafting commits, ask: did this task fix a bug or surface non-obvious knowledge that should land in `.trellis/spec/` so future-you (or future-AI) doesn't repeat the mistake? If yes, return to Phase 3.3 first — spec writes belong in the same task's commit batch, not as a forgotten follow-up.

The AI drives a batched commit of this task's code changes so the active workflow can wrap up cleanly afterwards. Goal: produce work commits FIRST, then bookkeeping (archive + journal) commits land after — never interleaved.

**Step-by-step**:

1. **Inspect dirty state**:

   ```bash
   git status --porcelain
   ```

   Snapshot every dirty path. If the working tree is clean, skip to 3.5.

2. **Learn commit style** from recent history (so drafted messages blend in):

   ```bash
   git log --oneline -5
   ```

   Note the prefix convention (`feat:` / `fix:` / `chore:` / `docs:` ...), language (中文/English), and length style.

3. **Classify dirty files into two groups**:
   - **AI-edited this session** — files you wrote/edited via Edit/Write/Bash tool calls in this session. You know what changed and why.
   - **Unrecognized** — dirty files you did NOT touch this session (could be the user's manual edits, leftover WIP from a previous session, or unrelated work). Do NOT silently include these.

4. **Draft a commit plan**. Group AI-edited files into logical commits (1 commit per coherent change unit, not 1 commit per file). Each entry: `<commit message>` + file list. List unrecognized files separately at the bottom.

5. **Present the plan once, ask for one-shot confirmation**. Format:

   ```
   Proposed commits (in order):
     1. <message>
        - <file>
        - <file>
     2. <message>
        - <file>

   Unrecognized dirty files (NOT in any commit — confirm include/exclude):
     - <file>
     - <file>

   Reply 'ok' / '行' to execute. Reply with edits, or '我自己来' / 'manual' to abort.
   ```

6. **On confirmation**: run `git add <files>` + `git commit -m "<msg>"` for each batch in order. Do not amend. Do not push.

7. **On rejection** (user replies "不行" / "我自己来" / "manual" / any pushback on the plan): stop. Do not attempt a second plan. The user will commit by hand; you skip ahead to 3.5 once they confirm.

**Rules**:

- No `git commit --amend` anywhere — three-stage three-commit flow (work commits → archive commit → journal commit).
- Never push to remote in this step.
- If the user wants different message wording but accepts the file grouping, edit the message and re-confirm once — but if they reject the grouping, exit to manual mode.
- The batched plan is one prompt; do not prompt per commit.

#### 3.5 Wrap-up reminder

After the above, continue or remind the user to complete wrap-up through the active workflow and host (archive the task, record the session). If automatic routing is unavailable, `/finish-work` remains an explicit fallback.

---

## Customizing Trellis (for forks)

This section is for developers who want to modify the Trellis workflow itself. All customization is done by editing this file; the scripts are parsers only.

### Changing what a step means

Edit the corresponding step's walkthrough body in the Phase 1 / 2 / 3 sections above. Critical invariants:

- No active task must triage first and ask for task-creation consent before creating a Trellis task.
- Planning must distinguish lightweight PRD-only tasks from complex tasks that require `prd.md`, `design.md`, and `implement.md` before start.
- Every required execution path must keep the Phase 3.4 commit reminder reachable before workflow completion; an explicit `/trellis:finish-work` fallback must remain available.

All tag blocks live in the `## Phase Index` section above, immediately after each phase summary:

| Scope                                                      | Corresponding tag                                                        |
| ---------------------------------------------------------- | ------------------------------------------------------------------------ |
| No active task (before Phase 1)                            | `[workflow-state:no_task]` (after the Phase Index ASCII art)             |
| All of Phase 1 (task created → ready for implementation)   | `[workflow-state:planning]` (after Phase 1 summary)                      |
| Codex inline Phase 1                                       | `[workflow-state:planning-inline]`                                       |
| Phase 2 + Phase 3.2–3.4 (implementation + check + wrap-up) | `[workflow-state:in_progress]` (after Phase 2 summary)                   |
| Codex inline Phase 2 + Phase 3.2–3.4                       | `[workflow-state:in_progress-inline]`                                    |
| After Phase 3.5 (archived)                                 | `[workflow-state:completed]` (after Phase 3 summary; **currently DEAD**) |

### Changing the per-turn prompt text

Directly edit the body of the corresponding `[workflow-state:STATUS]` block. After editing, run `trellis update` (if you're a template maintainer) or restart your AI session (if you're customizing your own project) — no script changes required.

### Adding a custom status

Add a new block:

```
[workflow-state:my-status]
your per-turn prompt text
[/workflow-state:my-status]
```

Constraints:

- STATUS charset: `[A-Za-z0-9_-]+` (underscores and hyphens allowed, e.g. `in-review`, `blocked-by-team`)
- A lifecycle hook must write `task.json.status` to your custom value, otherwise the tag is never read
- Lifecycle hooks live in `task.json.hooks.after_*` and bind to one of `after_create / after_start / after_finish / after_archive`

### Adding a lifecycle hook

Add a `hooks` field to your `task.json`:

```json
{
  "hooks": {
    "after_finish": ["your-script-or-command-here"]
  }
}
```

Supported events: `after_create / after_start / after_finish / after_archive`. Note that `after_finish` ≠ a status change (it only clears the active-task pointer); use `after_archive` for "task is done" notifications.

### Full contract

For the workflow state machine's runtime contract, the locations of all status writers, pseudo-statuses (`no_task` / `stale_<source_type>`), the hook reachability matrix, and other deep details, see:

- `.trellis/spec/cli/backend/workflow-state-contract.md` — runtime contract + writer table + test invariants
- `.trellis/scripts/inject-workflow-state.py` — actual parser (reads workflow.md only, no embedded text)
