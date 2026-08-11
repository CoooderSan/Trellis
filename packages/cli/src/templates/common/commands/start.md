# Start Session

Initialize a Trellis-managed development session. This platform has no session-start hook, so manually load the equivalent compact context by following these steps.

Natural-language intent is the default workflow entry. This explicit command is a capability fallback for platforms without a session-start hook, not a required first command in a daily command chain.

---

## Step 1: Current state

Identity, git status, current task, active tasks, journal location.

```bash
{{PYTHON_CMD}} ./.trellis/scripts/get_context.py
```

If this output includes a line beginning `Trellis update available:`, copy the full line verbatim when summarizing session context. Do not shorten operational command hints.

## Step 2: Workflow overview

Compact Phase Index, request triage rules, planning artifact contract, and the step-detail command.

```bash
{{PYTHON_CMD}} ./.trellis/scripts/get_context.py --mode phase
```

Full guide in `.trellis/workflow.md` (read on demand).

## Step 3: Guideline indexes

Discover packages + spec layers, then read each relevant index file.

```bash
{{PYTHON_CMD}} ./.trellis/scripts/get_context.py --mode packages
cat .trellis/spec/guides/index.md
cat .trellis/spec/<package>/<layer>/index.md   # for each relevant layer
```

Index files list the specific guideline docs to read when you actually start coding.

## Step 4: Decide next action

From Step 1 you know the current task and status. Check the task directory:

- **Active task status `planning` + no `prd.md`** → Phase 1.1. Load the `trellis-brainstorm` skill.
- **Active task status `planning` + `prd.md` exists** → stay in Phase 1. Lightweight tasks can be PRD-only; complex tasks need `design.md` + `implement.md`. Load the relevant Phase 1 step detail before `task.py start`.
- **Active task status `in_progress`** → Phase 2 step 2.1. Load the step detail:
  ```bash
  {{PYTHON_CMD}} ./.trellis/scripts/get_context.py --mode phase --step 2.1 --platform {{CLI_FLAG}}
  ```
- **No active task** → classify the natural-language request first. Read-only questions and ordinary operational work normally proceed without a development task. Feature, bug-fix, refactor, or maintenance development asks for task-creation consent and enters planning; review revisions reuse their existing task/MR context. If the user declines a task for broad development work, explain the risk, clarify scope, or suggest a smaller split.

## Dazz constraint voice

Dazz is the presentation voice for Trellis-owned reminders, teaching, corrections, and hard stops; it does not change the classification or gate result.

- Keep ordinary investigation, progress updates, and check summaries natural. Do not force Dazz into every reply.
- Preserve the voice of third-party or team-governance rules instead of rewriting them as Dazz.
- Use a light, protective teaching tone for reminders, a direct correction for strong constraints, and a clear stop for a hard gate.
- When a hard gate blocks progress, make the first user-facing sentence Dazz's direct fatherly correction, then give the single concrete action that unblocks the workflow. Prefer the safe recommended path when one exists.
- Apply the actual classified rule: business features need approved Product Intent; eligible bugfix/maintenance work may use a complete Task Basis with a concrete `NOT_REQUIRED` reason; readonly and ordinary operational work remain outside the development gate.

Example: `先停下。Dazz 不会让你在 Product Intent 还没批准时直接创建业务功能任务。先补齐已批准的链接，我再带你把 Task Basis 立起来。`

---

## Skill routing (quick reference)

| User intent                           | Skill                 |
| ------------------------------------- | --------------------- |
| New feature / unclear requirements    | `trellis-brainstorm`  |
| About to write code                   | `trellis-before-dev`  |
| Done coding / quality check           | `trellis-check`       |
| Stuck / fixed same bug multiple times | `trellis-break-loop`  |
| Learned something worth capturing     | `trellis-update-spec` |

This table describes routing, not a command sequence the user must invoke. Full rules + anti-rationalization table in `.trellis/workflow.md`.
