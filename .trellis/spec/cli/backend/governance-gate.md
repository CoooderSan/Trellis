# Classified Governance Gate

> Contracts for request classification, Task Basis validation, and the
> `task_create` / `task_start` lifecycle choke points.

## 1. Scope and triggers

The agent classifies a natural-language request before calling task commands;
hooks and gates do not create tasks or infer product intent. The supported
classifications are:

| Classification            | Development task                                 | Product Intent rule                                                                    |
| ------------------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------- |
| `readonly`, `operational` | Normally no; `task_create` blocks                | Not required                                                                           |
| `business-feature`        | Yes                                              | A meaningful approved link is required before create and `Status: LINKED` before start |
| `bugfix`, `maintenance`   | When persistence/risk warrants                   | `Status: NOT_REQUIRED` plus a concrete reason                                          |
| `review-revision`         | Reuse the original task/MR context when possible | `LINKED` or reasoned `NOT_REQUIRED`                                                    |

`task_create` is the early classification/Product Intent gate.
`task_start` validates the persisted Task Basis and planning artifacts. A
legacy or unknown artifact is reported as `UNKNOWN` with migration guidance;
it is never silently treated as a business feature.

## 2. `task.py` create and start signatures

Create accepts the normal task arguments plus:

```text
task.py create <name> [--classification <value>]
  [--product-intent-link <url-or-id>]
  [--product-intent-reason <reason>] [--no-start]
```

With enforcement enabled, a supported development classification is required.
A business feature additionally requires `--product-intent-link`. Successful
create persists `task.json.meta.classification` and creates the compatibility-
named `intent.md` as a Task Basis skeleton.

```text
task.py start <task-dir>
```

Start evaluates the persisted directory before changing active-task/session
state. A blocked gate returns exit code `1`; an allowed or disabled gate
continues through the existing start flow.

## 3. Configuration, environment, and artifact contracts

Generated projects enable the local classified gate by default:

```yaml
governance:
  enabled: true
  enforce:
    task_create: true
    task_start: true
  # command: "python3 ./team/evaluate_gate.py --json"
```

Configs without a `governance` section use classified governance by default.
Projects may explicitly opt out with `enabled: false`, or disable one event
with a recognized false value. Invalid core-event flags fail safe to enforced.
An optional `command` replaces the local evaluator while retaining the same
choke points.
It receives `TRELLIS_GOVERNANCE_EVENT` and, when present,
`TRELLIS_GATE_MESSAGE`, `TRELLIS_TASK_DIR`,
`TRELLIS_REQUEST_CLASSIFICATION`, and `TRELLIS_PRODUCT_INTENT_LINK`.

The external command runs from the repository root with a 30-second timeout.
It must exit zero and emit JSON with `allowed: true` to pass. Its supported
fields are `allowed`, `status`, `summary`, `blockers`, and
`nextStep`/`next_step`; malformed, contradictory, failed, or timed-out results
fail closed. Allowed results use `ready` or `not_required` with no blockers;
denied results use `blocked`, `pending`, or `unknown`.

`intent.md` must contain these H2 sections: `Classification`, `Product Intent`,
`Requested Outcome`, `In Scope / Out of Scope`, and
`Acceptance or Verification Basis`. `prd.md` remains a planning artifact and
must contain meaningful `Goal`, `Requirements`, and `Acceptance Criteria`.
Neither `design.md` nor `implement.md` is globally required for lightweight
work.

### Localized planning documents

Required concepts are stable; spelling, order, numbering, and layout are not
approval gates. The parser accepts H2–H6 sections, optional numeric/Chinese
numbering, English, Chinese, and bilingual headings (for example
`## 1. 目标（Goal）`). Extra sections and nested requirement/acceptance sections
are allowed. `SECTION_ALIASES` in `common/governance_gate.py` owns the accepted
vocabulary; templates and skills must follow it.

| Concept | Chinese headings |
| --- | --- |
| Goal | 目标、任务目标 |
| Requirements | 需求、要求、需求说明、功能需求 |
| Acceptance Criteria | 验收标准、验收条件 |
| Classification | 分类、任务分类、请求分类 |
| Product Intent | 产品意图 |
| Requested Outcome | 预期结果、期望结果、预期成果 |
| In Scope / Out of Scope | 范围与非目标、范围与非范围、范围边界、范围内与范围外 |
| Acceptance or Verification Basis | 验收或验证依据、验收与验证依据、验收依据、验证依据 |

Product Intent field labels accept `Status / 状态`, `Link / 链接 / 引用`, and
`Reason / 原因 / 理由`, with ASCII or full-width colons. Classification/status
enum values remain the machine-readable values documented above.

A combined `要求与验收` heading may contain separate `### 需求` and
`### 验收标准` subsections. Do not count undifferentiated prose twice to pretend
both concepts have evidence. Headings alone, comments, empty checkboxes, and
placeholders are not evidence. Code under a real section can describe
requirements or verification; headings inside fenced code cannot create
document sections. Errors distinguish a missing
or unrecognized section from a recognized but empty section, and list accepted
Chinese headings. Format-only repairs preserve existing approval.

This is a structural completeness check, not semantic product review or proof
of user approval. Removing language/layout restrictions must not remove the
classification, scope, acceptance, or Product Intent evidence checks.

## 4. Validation and error matrix

| Event/input                                                                                | Result                    | Required remediation                                                                                    |
| ------------------------------------------------------------------------------------------ | ------------------------- | ------------------------------------------------------------------------------------------------------- |
| Create has missing/unsupported classification                                              | Block                     | Classify explicitly; do not infer business feature                                                      |
| Create is `readonly` or `operational`                                                      | Block task creation       | Execute from the user request/authorization, or reclassify only if scope becomes persistent development |
| Business-feature create lacks Product Intent link                                          | Block                     | Approve and pass the link/document id                                                                   |
| Start lacks valid `task.json`, `intent.md`, supported classification, or required sections | Block as legacy/invalid   | Restore the persisted task identity, then migrate and complete the Task Basis                           |
| `task.json` and Task Basis classifications differ                                          | Block                     | Make the two persisted identities agree                                                                 |
| Business feature is not `LINKED` or lacks link                                             | Block                     | Link approved Product Intent                                                                            |
| Bugfix/maintenance is not `NOT_REQUIRED` or lacks reason                                   | Block                     | Record the engineering reason                                                                           |
| Review revision is neither meaningfully `LINKED` nor reasoned `NOT_REQUIRED`               | Block                     | Reference original approved/review evidence                                                             |
| PRD is missing or incomplete                                                               | Block                     | Complete the minimal planning basis                                                                     |
| Gate/event is explicitly disabled                                                          | Allow with `not_required` | Record the project opt-out when relevant                                                                |

Placeholder tokens (`TBD`, `TODO`, `UNKNOWN`, `REQUIRED`, angle-bracket
placeholders, and their configured Chinese equivalents) are not meaningful
evidence.

## 5. Good, baseline, and bad examples

Good business-feature basis:

```markdown
## Classification

business-feature

## Product Intent

Status: LINKED
Link: https://kb.example/product-intent/checkout
Reason: Approved checkout direction.
```

Baseline maintenance basis:

```markdown
## Classification

maintenance

## Product Intent

Status: NOT_REQUIRED
Link:
Reason: Dependency maintenance with no product behavior change.
```

Bad basis:

```markdown
## Classification

TBD

## Product Intent

Status: NOT_REQUIRED
Reason: TBD
```

The bad example fails because neither classification nor reason is meaningful.
The existence of `intent.md` alone never proves Product Intent compliance.

## 6. Tests and required assertions

`packages/cli/test/templates/governance-gate.test.ts` is the focused executable
contract. It must cover:

- readonly/operational create rejection with no task directory created;
- business-feature rejection before create without a link;
- linked business-feature create and start;
- bugfix/maintenance `NOT_REQUIRED` reason validation;
- review-revision reuse of review evidence;
- legacy artifact `UNKNOWN` migration guidance;
- default-on enforcement when config omits the `governance` section;
- explicit configuration opt-out;
- external evaluator failure/timeout/malformed output whenever that path changes.

Also keep dogfood/template twins byte-consistent and run template rendering,
init/update integration, lint, typecheck, and format checks proportionate to
the changed surface. A skipped check requires a reason and alternative
evidence; exit code zero alone does not prove test discovery.

## 7. Wrong versus correct implementation

Wrong: infer every coding request as a business feature, accept `intent.md`
existence without parsing it, move the gate only into prose/hooks, restore the
discarded blanket plan/intent diff, or let evaluator errors pass. These choices
either over-block operational work or remove the lifecycle choke point.

Correct: classify before task creation, enforce Product Intent only where the
classification requires it, persist and validate Task Basis evidence at start,
make opt-out explicit, and keep the generic Trellis gate replaceable by a
team-owned evaluator. Product/governance content stays external; this repository
owns only the generic contract and integration points.

## 8. Dazz presentation contract

Dazz is a presentation layer over Trellis-owned governance. It explains an
already-determined classification or gate result; it must not infer, weaken, or
strengthen that result.

| Situation                                                | Voice behavior                                                                                           |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Recoverable reminder or teaching                         | Use a light, protective explanation and recommend the safe path when one exists                          |
| Strong Trellis-owned constraint                          | Correct directly                                                                                         |
| Hard Trellis-owned gate                                  | Stop in the first user-facing sentence, then give the single concrete action that can unblock progress  |
| Ordinary investigation, progress, or quality reporting   | Keep the normal conversational voice; do not force Dazz into the report                                  |
| Third-party or team-governance rule                       | Preserve that rule owner's voice                                                                         |
| Readonly or ordinary operational request                 | Do not introduce a development gate or Dazz hard stop                                                    |

The corrective content must name the actual classified requirement:

- business feature: obtain the approved Product Intent link before create;
- bugfix/maintenance: complete the Task Basis and give a concrete reason for
  `NOT_REQUIRED` before start;
- planning transition: obtain fresh approval of the latest planning summary;
- implementation: load every applicable required spec before editing.

Wrong:

```text
先停下。所有开发都必须先补 Product Intent。
```

This recreates the discarded blanket gate and incorrectly blocks eligible
bugfix, maintenance, readonly, and operational paths.

Correct business-feature hard stop:

```text
先停下。Dazz 不会让你在 Product Intent 还没批准时直接创建业务功能任务。先补齐已批准的链接，我再带你把 Task Basis 立起来。
```

Correct maintenance hard stop:

```text
先停下。这个 NOT_REQUIRED 还没有说明为什么成立，Dazz 不会让任务带着空依据进入实现。先把具体理由和验收依据补齐。
```

Required prevention checks:

- `governance-routing-parity.test.ts` locks the common start, brainstorm,
  before-dev, and workflow wording and verifies generated Claude/Codex output;
- `init.integration.test.ts` verifies the same contract in fresh projects;
- `governance-gate.test.ts` remains authoritative for executable
  business-feature, bugfix/maintenance, readonly, and operational boundaries;
  do not duplicate those mechanics as persona-only tests;
- the common check template must remain free of blanket Dazz narration so
  ordinary quality summaries stay natural.
