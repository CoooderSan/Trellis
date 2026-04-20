---
name: brainstorm
description: "Brainstorm - Requirements Discovery (AI Coding Enhanced)"
---

# Brainstorm - Requirements Discovery (AI Coding Enhanced)

Guide AI through collaborative requirements discovery **before implementation**, optimized for AI coding workflows:

* **Task-first** (capture ideas immediately)
* **Action-before-asking** (reduce low-value questions)
* **Research-first** for technical choices (avoid asking users to invent options)
* **Diverge → Converge** (expand thinking, then lock MVP)

---

## When to Use

Triggered from `$start` when the user describes a development task, especially when:

* requirements are unclear or evolving
* there are multiple valid implementation paths
* trade-offs matter (UX, reliability, maintainability, cost, performance)
* the user might not know the best options up front

---

## Core Principles (Non-negotiable)

1. **Task-first (capture early)**
   Always ensure a task exists at the start so the user's ideas are recorded immediately.

2. **Action before asking**
   If you can derive the answer from repo code, docs, configs, conventions, or quick research — do that first.

3. **One question per message**
   Never overwhelm the user with a list of questions. Ask one, update PRD, repeat.

4. **Prefer concrete options**
   For preference/decision questions, present 2–3 feasible, specific approaches with trade-offs.

5. **Research-first for technical choices**
   If the decision depends on industry conventions / similar tools / established patterns, do research first, then propose options.

6. **Diverge → Converge**
   After initial understanding, proactively consider future evolution, related scenarios, and failure/edge cases — then converge to an MVP with explicit out-of-scope.

7. **No meta questions**
   Do not ask "should I search?" or "can you paste the code so I can continue?"
   If you need information: search/inspect. If blocked: ask the minimal blocking question.

---

## Step 0: Respect Current Session Context

Before any task creation or PRD seeding, confirm the injected session context already allows progress.

If `$start` surfaced blockers in the injected session gate summary or referenced indexes:

- summarize the prerequisite in user language
- tell the user what must be completed first
- do not create a task directory
- do not seed `prd.md`

Do not hardcode package-specific gates here.
Only when the injected rule entry allows task creation may you create a task and continue brainstorm.

Once the current session context allows progress, create the task immediately:

* Use a **temporary working title** derived from the user's message.
* It's OK if the title is imperfect — refine later in PRD.

```bash
TASK_DIR=$(python3 ./.trellis/scripts/task.py create "brainstorm: <short goal>" --slug <auto>)
```

Create/seed `prd.md` immediately with what you know:

```markdown
# brainstorm: <short goal>

## Goal

<one paragraph: what + why>

## What I already know

* <facts from user message>
* <facts discovered from repo/docs>

## Assumptions (temporary)

* <assumptions to validate>

## Open Questions

* <ONLY Blocking / Preference questions; keep list short>

## Requirements (evolving)

* <start with what is known>

## Acceptance Criteria (evolving)

* [ ] <testable criterion>

## Definition of Done (team quality bar)

* Tests added/updated (unit/integration where appropriate)
* Lint / typecheck / CI green
* Docs/notes updated if behavior changes
* Rollout/rollback considered if risky

## Out of Scope (explicit)

* <what we will not do in this task>

## Technical Notes

* <files inspected, constraints, links, references>
* <research notes summary if applicable>
```

---

## Step 1: Auto-Context (DO THIS BEFORE ASKING QUESTIONS)

Before asking questions like "what does the code look like?", gather context yourself:

### Repo inspection checklist

* Identify likely modules/files impacted
* Locate existing patterns (similar features, conventions, error handling style)
* Check configs, scripts, existing command definitions
* Note any constraints (runtime, dependency policy, build tooling)

### Documentation checklist

* Look for existing PRDs/specs/templates
* Look for command usage examples, README, ADRs if any
* Read the injected package or layer indexes before assuming detailed rules

Write findings into PRD:

* Add to `What I already know`
* Add constraints/links to `Technical Notes`

---

## Step 2: Classify Complexity (still useful, not gating task creation)

| Complexity   | Criteria                                               | Action                                      |
| ------------ | ------------------------------------------------------ | ------------------------------------------- |
| **Trivial**  | Single-line fix, typo, obvious change                  | Skip brainstorm, implement directly         |
| **Simple**   | Clear goal, 1–2 files, scope well-defined              | Ask 1 confirm question, then implement      |
| **Moderate** | Multiple files, some ambiguity                         | Light brainstorm (2–3 high-value questions) |
| **Complex**  | Vague goal, architectural choices, multiple approaches | Full brainstorm                             |

> Note: Task creation only happens after the injected session context allows progress. Classification only affects depth of brainstorming.

---

## Step 3: Question Gate (Ask ONLY high-value questions)

Before asking ANY question, run the following gate:

### Gate A — Can I derive this without the user?

If answer is available via:

* repo inspection (code/config)
* docs/specs/conventions
* quick market/OSS research

→ **Do not ask.** Fetch it, summarize, update PRD.

### Gate B — Is this a meta/lazy question?

Examples:

* "Should I search?"
* "Can you paste the code so I can proceed?"
* "What does the code look like?" (when repo is available)

→ **Do not ask.** Take action.

### Gate C — What type of question is it?

* **Blocking**: cannot proceed without user input
* **Preference**: multiple valid choices, depends on product/UX/risk preference
* **Derivable**: should be answered by inspection/research

→ Only ask **Blocking** or **Preference**.

---

## Step 4: Research-first Mode (Mandatory for technical choices)

### Trigger conditions (any → research-first)

* The task involves selecting an approach, library, protocol, framework, template system, plugin mechanism, or CLI UX convention
* The user asks for "best practice", "how others do it", "recommendation"
* The user can't reasonably enumerate options

### Research steps

1. Identify 2–4 comparable tools/patterns
2. Summarize common conventions and why they exist
3. Map conventions onto our repo constraints
4. Produce **2–3 feasible approaches** for our project

### Research output format (PRD)

Add a section in PRD (either within Technical Notes or as its own):

```markdown
## Research Notes

### What similar tools do

* ...
* ...

### Constraints from our repo/project

* ...

### Feasible approaches here

**Approach A: <name>** (Recommended)

* How it works:
* Pros:
* Cons:

**Approach B: <name>**

* How it works:
* Pros:
* Cons:

**Approach C: <name>** (optional)

* ...
```

Then ask **one** preference question:

* "Which approach do you prefer: A / B / C (or other)?"

---

## Integration with Start Workflow

After brainstorm completes, continue into the shared task workflow:

```text
Brainstorm
  Step 0: confirm the injected rule entry allows task creation, then create task directory + seed PRD
  Step 1–4: Discover requirements, research, converge
  ↓
Task Workflow
  Research → Configure context → Activate → Implement → Check → Complete
```
