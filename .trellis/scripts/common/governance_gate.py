#!/usr/bin/env python3
"""Classified governance gates for Trellis task lifecycle operations.

Trellis owns the generic choke points and Task Basis contract. Team-specific
Product Intent policy may replace the local evaluator through config.yaml.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import unicodedata
from dataclasses import dataclass
from pathlib import Path

from .config import (
    get_governance_command,
    is_governance_event_enforced,
)
from .io import read_json
from .paths import get_repo_root


DEVELOPMENT_CLASSIFICATIONS = {
    "business-feature",
    "bugfix",
    "maintenance",
    "review-revision",
}
NON_TASK_CLASSIFICATIONS = {"readonly", "operational"}
ALL_CLASSIFICATIONS = DEVELOPMENT_CLASSIFICATIONS | NON_TASK_CLASSIFICATIONS
TBD_RE = re.compile(
    r"\b(TBD|TODO|UNKNOWN|REQUIRED)\b|待定|未填写|未确认|<[^>]+>",
    re.IGNORECASE,
)

# One vocabulary for localized Task Basis and PRD headings. Machine-readable
# classification and Product Intent status values remain unchanged.
SECTION_ALIASES = {
    "classification": ("分类", "任务分类", "请求分类"),
    "product intent": ("产品意图",),
    "requested outcome": ("预期结果", "期望结果", "预期成果"),
    "in scope out of scope": ("范围与非目标", "范围与非范围", "范围边界", "范围内与范围外"),
    "acceptance or verification basis": ("验收或验证依据", "验收与验证依据", "验收依据", "验证依据"),
    "goal": ("目标", "任务目标"),
    "requirements": ("需求", "要求", "需求说明", "功能需求"),
    "acceptance criteria": ("验收标准", "验收条件"),
}
FIELD_ALIASES = {
    "Status": ("状态",),
    "Link": ("链接", "引用"),
    "Reason": ("原因", "理由"),
}


@dataclass(frozen=True)
class GateResult:
    """Machine-readable result returned by local or external evaluators."""

    allowed: bool
    status: str
    summary: str
    blockers: list[str]
    next_step: str | None = None
    source: str = "classified_task_basis"

    def as_dict(self) -> dict:
        return {
            "allowed": self.allowed,
            "status": self.status,
            "summary": self.summary,
            "blockers": self.blockers,
            "nextStep": self.next_step,
            "source": self.source,
        }


def normalize_classification(value: object) -> str:
    """Normalize supported request classification spelling."""
    if not isinstance(value, str):
        return "unknown"
    normalized = re.sub(r"[\s_]+", "-", value.strip().lower())
    aliases = {
        "feature": "business-feature",
        "business": "business-feature",
        "read-only": "readonly",
        "review": "review-revision",
        "refactor": "maintenance",
        "dependency": "maintenance",
    }
    return aliases.get(normalized, normalized) if normalized else "unknown"


def build_task_basis(
    classification: str,
    *,
    product_intent_link: str | None = None,
    product_intent_reason: str | None = None,
    requested_outcome: str | None = None,
) -> str:
    """Build the compatibility-named intent.md as a Task Basis skeleton."""
    normalized = normalize_classification(classification)
    linked = normalized == "business-feature" and bool(
        (product_intent_link or "").strip()
    )
    status = "LINKED" if linked else "NOT_REQUIRED"
    link = (product_intent_link or "").strip()
    reason = (product_intent_reason or "").strip()
    outcome = (requested_outcome or "").strip() or "TBD"
    if linked and not reason:
        reason = "Approved Product Intent is linked above."

    return f"""# Task Basis

## Classification

{normalized}

## Product Intent

Status: {status}
Link: {link}
Reason: {reason or "TBD"}

## Requested Outcome

{outcome}

## In Scope / Out of Scope

- In scope: TBD
- Out of scope: TBD

## Acceptance or Verification Basis

- TBD
"""


def _normalize_heading(value: str) -> str:
    value = unicodedata.normalize("NFKC", value).strip().lower()
    value = re.sub(r"^(?:\d+(?:\.\d+)*|[一二三四五六七八九十百]+)[.、:)\s]+", "", value)
    normalized = " ".join(re.sub(r"[^\w]+|_", " ", value).split())
    for canonical, aliases in SECTION_ALIASES.items():
        if normalized == canonical or normalized in aliases:
            return canonical
        for alias in aliases:
            if normalized in (f"{canonical} {alias}", f"{alias} {canonical}"):
                return canonical
    return normalized


def _extract_h2_sections(content: str) -> dict[str, str]:
    """Read logical sections below the document title (H2-H6).

    Keep nested prose and code in their parent section. Comments and headings
    alone are not evidence; fenced headings cannot create document sections.
    The historical helper name is retained.
    """
    sections: dict[str, list[str]] = {}
    stack: list[tuple[int, str]] = []
    fence: str | None = None
    content = re.sub(r"<!--.*?(?:-->|\Z)", "", content, flags=re.DOTALL)
    for line in content.splitlines():
        fence_match = re.match(r"^\s{0,3}(`{3,}|~{3,})", line)
        if fence is not None:
            if re.fullmatch(rf"\s{{0,3}}{re.escape(fence[0])}{{{len(fence)},}}\s*", line):
                fence = None
            else:
                for current in dict.fromkeys(key for _, key in stack):
                    sections[current].append(line)
            continue
        if fence_match:
            fence = fence_match.group(1)
            continue
        match = re.match(r"^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$", line)
        if match:
            level = len(match.group(1))
            while stack and stack[-1][0] >= level:
                stack.pop()
            if level > 1:
                current = _normalize_heading(match.group(2))
                stack.append((level, current))
                sections.setdefault(current, [])
            continue
        for current in dict.fromkeys(key for _, key in stack):
            sections[current].append(line)
    return {key: "\n".join(lines).strip() for key, lines in sections.items()}


def _meaningful(value: str | None) -> bool:
    if not value:
        return False
    meaningful_lines: list[str] = []
    for raw_line in value.splitlines():
        line = re.sub(r"^[-*]\s+\[[ xX]\]\s*", "", raw_line.strip()).strip()
        line = re.sub(r"^[-*]\s+", "", line).strip()
        if not line or TBD_RE.search(line):
            continue
        meaningful_lines.append(line)
    return bool(meaningful_lines)


def _field(body: str, name: str) -> str:
    names = "|".join(re.escape(key) for key in (name, *FIELD_ALIASES.get(name, ())))
    match = re.search(
        rf"^[ \t]*(?:{names})[ \t]*[:：][ \t]*([^\r\n]*)[ \t]*$",
        body,
        re.MULTILINE | re.IGNORECASE,
    )
    return match.group(1).strip() if match else ""


def _section_blocker(label: str, heading: str, sections: dict[str, str]) -> str:
    aliases = " / ".join(SECTION_ALIASES[heading])
    detail = "Section has no substantive content." if heading in sections else (
        "Section heading was not recognized or is absent. Recognized headings in this document: "
        + (", ".join(sections) or "none") + "."
    )
    return (
        f"{label} section is missing or incomplete: ## {heading.title()}. "
        f"{detail} Accepted Chinese headings: {aliases}; English or bilingual headings also work."
    )


def _blocked(summary: str, blockers: list[str], next_step: str) -> GateResult:
    return GateResult(
        allowed=False,
        status="blocked",
        summary=summary,
        blockers=blockers,
        next_step=next_step,
    )


def _result_for_create(
    classification: str | None,
    product_intent_link: str | None,
) -> GateResult:
    normalized = normalize_classification(classification)
    if normalized == "unknown" or normalized not in ALL_CLASSIFICATIONS:
        return _blocked(
            "Task creation needs an explicit request classification.",
            [
                "Classification is missing or unsupported; it was not silently treated as a business feature.",
            ],
            "Classify the request as business-feature, bugfix, maintenance, or review-revision. Readonly and ordinary operational work should not create a development task.",
        )

    if normalized in NON_TASK_CLASSIFICATIONS:
        return _blocked(
            f"{normalized} requests do not create a development task by default.",
            ["Use the user's question or authorized operation as the execution basis."],
            "Proceed without task.py create, or reclassify only if the scope has become persistent development work.",
        )

    if normalized == "business-feature" and not _meaningful(product_intent_link):
        return _blocked(
            "Business feature creation requires approved Product Intent.",
            ["Missing a valid Product Intent link or document id."],
            "Approve Product Intent first, then pass --product-intent-link when creating the task.",
        )

    return GateResult(
        allowed=True,
        status="ready",
        summary="Classified task creation gate passed.",
        blockers=[],
    )


def _load_task_basis(task_path: Path) -> tuple[dict, dict[str, str], list[str]]:
    blockers: list[str] = []
    task_json_path = task_path / "task.json"
    task_json = read_json(task_json_path) if task_json_path.is_file() else None
    if not isinstance(task_json, dict) or not task_json:
        blockers.append("Missing or invalid persisted task identity: task.json")
        task_json = {}
    intent_path = task_path / "intent.md"
    if not intent_path.is_file():
        blockers.append("Missing Task Basis artifact: intent.md")
        return task_json, {}, blockers
    try:
        content = intent_path.read_text(encoding="utf-8")
    except OSError as exc:
        blockers.append(f"Task Basis could not be read: {exc}")
        return task_json, {}, blockers
    return task_json, _extract_h2_sections(content), blockers


def _result_for_start(repo_root: Path, task_dir: str | None) -> GateResult:
    if not task_dir:
        return _blocked(
            "Task activation needs a concrete task directory.",
            ["task_start did not provide task_dir."],
            "Run task.py start with a task directory.",
        )

    task_path = Path(task_dir)
    if not task_path.is_absolute():
        task_path = repo_root / task_path
    task_json, sections, blockers = _load_task_basis(task_path)

    meta = task_json.get("meta")
    meta = meta if isinstance(meta, dict) else {}
    artifact_classification = normalize_classification(sections.get("classification"))
    metadata_classification = normalize_classification(meta.get("classification"))
    classification = artifact_classification

    if not sections:
        blockers.append(
            "Legacy task format is UNKNOWN: migrate intent.md to the structured Task Basis template."
        )
    elif artifact_classification not in ALL_CLASSIFICATIONS:
        blockers.append(
            "Task Basis has no supported ## Classification; legacy tasks require explicit migration."
        )
    if (
        metadata_classification in ALL_CLASSIFICATIONS
        and artifact_classification in ALL_CLASSIFICATIONS
        and metadata_classification != artifact_classification
    ):
        blockers.append(
            "task.json meta.classification does not match intent.md ## Classification."
        )
    if metadata_classification in ALL_CLASSIFICATIONS and classification == "unknown":
        classification = metadata_classification

    if classification in NON_TASK_CLASSIFICATIONS:
        blockers.append(
            f"{classification} work should not be activated as a development task."
        )

    for heading in (
        "requested outcome",
        "in scope out of scope",
        "acceptance or verification basis",
    ):
        if not _meaningful(sections.get(heading)):
            blockers.append(_section_blocker("Task Basis", heading, sections))

    product_intent = sections.get("product intent", "")
    product_status = _field(product_intent, "Status").upper()
    product_link = _field(product_intent, "Link")
    product_reason = _field(product_intent, "Reason")

    if classification == "business-feature":
        if product_status != "LINKED":
            blockers.append("Business features require Product Intent Status: LINKED.")
        if not _meaningful(product_link):
            blockers.append("Business features require a valid Product Intent Link.")
    elif classification in {"bugfix", "maintenance"}:
        if product_status != "NOT_REQUIRED":
            blockers.append(
                f"{classification} Task Basis must explicitly declare Product Intent Status: NOT_REQUIRED."
            )
        if not _meaningful(product_reason):
            blockers.append("Product Intent NOT_REQUIRED requires a concrete Reason.")
    elif classification == "review-revision":
        if product_status not in {"LINKED", "NOT_REQUIRED"}:
            blockers.append(
                "Review revision Product Intent status must be LINKED or NOT_REQUIRED."
            )
        if product_status == "NOT_REQUIRED" and not _meaningful(product_reason):
            blockers.append("Product Intent NOT_REQUIRED requires a concrete Reason.")
        if product_status == "LINKED" and not _meaningful(product_link):
            blockers.append(
                "Review revision Product Intent LINKED requires the original approved or review evidence."
            )

    prd_path = task_path / "prd.md"
    if not prd_path.is_file():
        blockers.append("Missing required planning artifact: prd.md")
    else:
        try:
            prd_sections = _extract_h2_sections(prd_path.read_text(encoding="utf-8"))
        except OSError as exc:
            blockers.append(f"prd.md could not be read: {exc}")
        else:
            for heading in ("goal", "requirements", "acceptance criteria"):
                if not _meaningful(prd_sections.get(heading)):
                    blockers.append(_section_blocker("prd.md", heading, prd_sections))

    if blockers:
        return _blocked(
            "Classified Task Basis gate blocked task activation.",
            blockers,
            "Complete intent.md as a Task Basis and the applicable PRD sections before task.py start.",
        )

    return GateResult(
        allowed=True,
        status="ready",
        summary="Classified Task Basis gate passed.",
        blockers=[],
    )


def _result_from_command(
    command: str,
    *,
    event: str,
    repo_root: Path,
    message: str | None,
    task_dir: str | None,
    classification: str | None,
    product_intent_link: str | None,
) -> GateResult:
    env = os.environ.copy()
    env["TRELLIS_GOVERNANCE_EVENT"] = event
    if message:
        env["TRELLIS_GATE_MESSAGE"] = message
    if task_dir:
        env["TRELLIS_TASK_DIR"] = task_dir
    if classification:
        env["TRELLIS_REQUEST_CLASSIFICATION"] = classification
    if product_intent_link:
        env["TRELLIS_PRODUCT_INTENT_LINK"] = product_intent_link

    try:
        result = subprocess.run(
            command,
            cwd=str(repo_root),
            env=env,
            shell=True,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=30,
        )
    except subprocess.TimeoutExpired:
        return _blocked(
            "External governance evaluator timed out.",
            [command],
            "Restore the evaluator or explicitly opt out in config.yaml.",
        )
    except OSError as exc:
        return _blocked(
            "External governance evaluator could not be started.",
            [str(exc)],
            "Restore the evaluator or explicitly opt out in config.yaml.",
        )

    stdout = result.stdout.strip()
    stderr = result.stderr.strip()
    if result.returncode != 0:
        return _blocked(
            "External governance evaluator failed.",
            [stderr or stdout or f"Evaluator exited with status {result.returncode}."],
            "Restore the evaluator or explicitly opt out in config.yaml.",
        )

    if not stdout:
        return _blocked(
            "External governance evaluator returned no JSON result.",
            ["Expected a JSON object with boolean field allowed."],
            "Fix the evaluator output or explicitly opt out in config.yaml.",
        )

    try:
        payload = json.loads(stdout)
    except json.JSONDecodeError as exc:
        return _blocked(
            "External governance evaluator returned invalid JSON.",
            [str(exc)],
            "Fix the evaluator output or explicitly opt out in config.yaml.",
        )

    if not isinstance(payload, dict) or not isinstance(payload.get("allowed"), bool):
        return _blocked(
            "External governance evaluator returned a malformed result.",
            ["Expected a JSON object with boolean field allowed."],
            "Fix the evaluator output or explicitly opt out in config.yaml.",
        )

    allowed = payload["allowed"]
    raw_status = payload.get("status")
    if raw_status is not None and (
        not isinstance(raw_status, str) or not raw_status.strip()
    ):
        return _blocked(
            "External governance evaluator returned a malformed status.",
            ["status must be a non-empty string when provided."],
            "Fix the evaluator output or explicitly opt out in config.yaml.",
        )
    status = (
        raw_status.strip().lower()
        if raw_status
        else ("ready" if allowed else "blocked")
    )
    allowed_statuses = {"ready", "not_required"}
    blocked_statuses = {"blocked", "pending", "unknown"}
    if status not in allowed_statuses | blocked_statuses:
        return _blocked(
            "External governance evaluator returned a malformed status.",
            [
                "status must be ready/not_required when allowed, or blocked/pending/unknown when denied."
            ],
            "Fix the evaluator output or explicitly opt out in config.yaml.",
        )
    if (allowed and status not in allowed_statuses) or (
        not allowed and status not in blocked_statuses
    ):
        return _blocked(
            "External governance evaluator returned a contradictory result.",
            [f"allowed={str(allowed).lower()} conflicts with status={status}."],
            "Make allowed and status agree, or explicitly opt out in config.yaml.",
        )

    raw_blockers = payload.get("blockers", [])
    if not isinstance(raw_blockers, list) or any(
        not isinstance(item, str) for item in raw_blockers
    ):
        return _blocked(
            "External governance evaluator returned malformed blockers.",
            ["blockers must be a JSON array of strings when provided."],
            "Fix the evaluator output or explicitly opt out in config.yaml.",
        )
    if allowed and raw_blockers:
        return _blocked(
            "External governance evaluator returned a contradictory result.",
            ["allowed=true conflicts with non-empty blockers."],
            "Remove the blockers or deny the event explicitly.",
        )
    summary = payload.get("summary", "External governance evaluator result.")
    if not isinstance(summary, str):
        return _blocked(
            "External governance evaluator returned a malformed summary.",
            ["summary must be a string when provided."],
            "Fix the evaluator output or explicitly opt out in config.yaml.",
        )
    next_step = payload.get("nextStep", payload.get("next_step"))
    if next_step is not None and not isinstance(next_step, str):
        return _blocked(
            "External governance evaluator returned a malformed next step.",
            ["nextStep/next_step must be a string when provided."],
            "Fix the evaluator output or explicitly opt out in config.yaml.",
        )

    return GateResult(
        allowed=allowed,
        status=status,
        summary=summary,
        blockers=raw_blockers,
        next_step=next_step or None,
        source="command",
    )


def evaluate_governance_gate(
    event: str,
    *,
    message: str | None = None,
    task_dir: str | None = None,
    classification: str | None = None,
    product_intent_link: str | None = None,
    repo_root: Path | None = None,
) -> GateResult:
    """Evaluate a configured task lifecycle governance event."""
    root = repo_root or get_repo_root()
    if not is_governance_event_enforced(event, root):
        return GateResult(True, "not_required", f"Governance gate is disabled for {event}.", [])

    command = get_governance_command(root)
    if command:
        return _result_from_command(
            command,
            event=event,
            repo_root=root,
            message=message,
            task_dir=task_dir,
            classification=classification,
            product_intent_link=product_intent_link,
        )
    if event == "task_create":
        return _result_for_create(classification, product_intent_link)
    if event == "task_start":
        return _result_for_start(root, task_dir)
    return GateResult(True, "not_required", f"No local evaluator for {event}.", [])


def format_gate_block(event: str, gate: GateResult) -> str:
    lines = [
        f"Governance gate blocked {event}.",
        f"Status: {gate.status.upper()}",
        f"Summary: {gate.summary}",
    ]
    if gate.blockers:
        lines.append("Blockers:")
        lines.extend(f"- {blocker}" for blocker in gate.blockers)
    if gate.next_step:
        lines.append(f"Next: {gate.next_step}")
    return "\n".join(lines)


def enforce_governance_gate(
    event: str,
    *,
    message: str | None = None,
    task_dir: str | None = None,
    classification: str | None = None,
    product_intent_link: str | None = None,
    repo_root: Path | None = None,
    stream=None,
) -> bool:
    """Return True when the event may proceed; print a blocker otherwise."""
    gate = evaluate_governance_gate(
        event,
        message=message,
        task_dir=task_dir,
        classification=classification,
        product_intent_link=product_intent_link,
        repo_root=repo_root,
    )
    if gate.allowed:
        return True
    print(format_gate_block(event, gate), file=stream or sys.stderr)
    return False
