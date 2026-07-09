#!/usr/bin/env python3
"""Runtime governance gate enforcement.

Trellis owns the workflow choke points. Team-specific policy can live in
external specs or an executable adapter configured in .trellis/config.yaml.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

from .config import (
    get_governance_config,
    get_governance_command,
    is_governance_event_enforced,
)
from .paths import get_repo_root
from .session_gate import load_gate_state, summarize_gate_state


PASS_STATUSES = {"ready", "not_required"}
DEFAULT_PLAN_REQUIRED_SECTIONS = ["Goal", "Requirements", "Acceptance Criteria"]
DEFAULT_INTENT_REQUIRED_SECTIONS = ["Intent", "Scope", "Acceptance Criteria"]
DEFAULT_INTENT_DOCUMENT_PATH = "intent.md"
TBD_RE = re.compile(r"\b(TBD|TODO)\b|待定|未填写|未确认", re.IGNORECASE)


@dataclass
class GateResult:
    allowed: bool
    status: str
    summary: str
    blockers: list[str]
    next_step: str | None = None
    source: str = "session_gate"

    def as_dict(self) -> dict:
        return {
            "allowed": self.allowed,
            "status": self.status,
            "summary": self.summary,
            "blockers": self.blockers,
            "nextStep": self.next_step,
            "source": self.source,
        }


def _normalize_status(value: object) -> str:
    if isinstance(value, str) and value.strip():
        return value.strip().lower()
    return "not_evaluated"


def _is_true(value: object) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in {"true", "yes", "1", "on"}
    return False


def _is_false(value: object) -> bool:
    if isinstance(value, bool):
        return not value
    if isinstance(value, str):
        return value.strip().lower() in {"false", "no", "0", "off"}
    return False


def _result_from_payload(payload: dict, *, default_allowed: bool, source: str) -> GateResult:
    status = _normalize_status(payload.get("status"))
    allowed = bool(payload.get("allowed", default_allowed and status in PASS_STATUSES))

    blockers_value = payload.get("blockers")
    blockers = [str(item) for item in blockers_value] if isinstance(blockers_value, list) else []

    summary = payload.get("summary")
    if not isinstance(summary, str) or not summary.strip():
        summary = "Governance gate passed." if allowed else "Governance gate blocked progress."

    next_step = payload.get("nextStep") or payload.get("next_step")
    return GateResult(
        allowed=allowed,
        status=status,
        summary=summary,
        blockers=blockers,
        next_step=str(next_step) if next_step else None,
        source=source,
    )


def _result_from_session_gate(repo_root: Path) -> GateResult:
    state = load_gate_state(repo_root)
    if not state:
        return GateResult(
            allowed=False,
            status="not_evaluated",
            summary="No session gate result has been recorded for this developer.",
            blockers=[
                "Run session_gate.py inspect for the current request and persist a ready/not_required result before this Trellis action.",
            ],
            next_step="Run python3 ./.trellis/scripts/session_gate.py inspect --message \"<request summary>\".",
        )

    status = _normalize_status(state.get("status"))
    blockers_value = state.get("blockers")
    blockers = [str(item) for item in blockers_value] if isinstance(blockers_value, list) else []
    return GateResult(
        allowed=status in PASS_STATUSES,
        status=status,
        summary=summarize_gate_state(state),
        blockers=blockers,
        next_step=str(state.get("nextStep")) if state.get("nextStep") else None,
    )


def _normalize_heading(value: str) -> str:
    value = re.sub(r"[^a-z0-9]+", " ", value.lower())
    return " ".join(value.split())


def _format_repo_path(path: Path, repo_root: Path) -> str:
    try:
        return path.relative_to(repo_root).as_posix()
    except ValueError:
        return str(path)


def _extract_h2_sections(content: str) -> dict[str, str]:
    sections: dict[str, list[str]] = {}
    current: str | None = None
    for line in content.splitlines():
        match = re.match(r"^##\s+(.+?)\s*$", line)
        if match:
            current = _normalize_heading(match.group(1))
            sections.setdefault(current, [])
            continue
        if current is not None:
            sections[current].append(line)
    return {key: "\n".join(lines).strip() for key, lines in sections.items()}


def _section_has_meaningful_content(body: str) -> bool:
    lines = []
    for raw_line in body.splitlines():
        line = raw_line.strip()
        line = re.sub(r"^[-*]\s+", "", line)
        line = re.sub(r"^- \[[ xX]\]\s+", "", line)
        line = line.strip()
        if not line:
            continue
        if TBD_RE.fullmatch(line.rstrip(".。")):
            continue
        if TBD_RE.search(line) and line.lower().startswith(("tbd", "todo")):
            continue
        if TBD_RE.search(line) and len(line.split()) <= 6:
            continue
        lines.append(line)
    return bool(lines)


def _configured_required_sections(plan_gate: dict) -> list[str]:
    raw_sections = plan_gate.get("required_sections")
    if isinstance(raw_sections, list):
        sections = [str(item).strip() for item in raw_sections if str(item).strip()]
        if sections:
            return sections
    return DEFAULT_PLAN_REQUIRED_SECTIONS


def _configured_intent_sections(plan_gate: dict) -> list[str]:
    raw_sections = plan_gate.get("intent_required_sections")
    if isinstance(raw_sections, list):
        sections = [str(item).strip() for item in raw_sections if str(item).strip()]
        if sections:
            return sections
    return DEFAULT_INTENT_REQUIRED_SECTIONS


def _is_intent_document_required(plan_gate: dict) -> bool:
    intent_document = plan_gate.get("intent_document")
    if isinstance(intent_document, dict):
        return not _is_false(intent_document.get("enabled", True))

    raw_required = plan_gate.get("require_intent_document")
    if raw_required is not None:
        return _is_true(raw_required)

    return True


def _configured_intent_document_path(plan_gate: dict) -> str:
    intent_document = plan_gate.get("intent_document")
    if isinstance(intent_document, dict):
        path = intent_document.get("path")
        if isinstance(path, str) and path.strip():
            return path.strip()

    path = plan_gate.get("intent_document_path")
    if isinstance(path, str) and path.strip():
        return path.strip()

    return DEFAULT_INTENT_DOCUMENT_PATH


def _is_plan_gate_enabled(repo_root: Path) -> bool:
    governance = get_governance_config(repo_root)
    plan_gate = governance.get("plan_gate")
    return isinstance(plan_gate, dict) and _is_true(plan_gate.get("enabled"))


def _result_from_plan_gate(repo_root: Path, task_dir: str | None) -> GateResult:
    governance = get_governance_config(repo_root)
    raw_plan_gate = governance.get("plan_gate")
    plan_gate: dict = raw_plan_gate if isinstance(raw_plan_gate, dict) else {}

    if not task_dir:
        return GateResult(
            allowed=False,
            status="blocked",
            summary="Plan/Intent gate needs a task directory to inspect.",
            blockers=["task_start did not provide TRELLIS_TASK_DIR/task_dir."],
            next_step="Run task.py start with a concrete task directory.",
            source="plan_gate",
        )

    task_path = Path(task_dir)
    if not task_path.is_absolute():
        task_path = repo_root / task_path

    blockers: list[str] = []

    if _is_intent_document_required(plan_gate):
        intent_relative_path = _configured_intent_document_path(plan_gate)
        intent_path = Path(intent_relative_path)
        if not intent_path.is_absolute():
            intent_path = task_path / intent_path

        if not intent_path.is_file():
            blockers.append(
                "Missing required Intent document: "
                f"{_format_repo_path(intent_path, repo_root)}"
            )
        else:
            try:
                intent_content = intent_path.read_text(encoding="utf-8")
            except OSError as exc:
                blockers.append(f"Intent document could not be read: {exc}")
            else:
                intent_sections = _extract_h2_sections(intent_content)
                for section in _configured_intent_sections(plan_gate):
                    key = _normalize_heading(section)
                    body = intent_sections.get(key)
                    if body is None:
                        blockers.append(f"Missing required intent.md section: ## {section}")
                    elif not _section_has_meaningful_content(body):
                        blockers.append(f"Required intent.md section is still empty/TBD: ## {section}")

    prd_path = task_path / "prd.md"
    if not prd_path.is_file():
        return GateResult(
            allowed=False,
            status="blocked",
            summary="Plan/Intent is missing.",
            blockers=[*blockers, f"Missing required planning artifact: {_format_repo_path(prd_path, repo_root)}"],
            next_step="Create intent.md and prd.md with real Intent, Goal, Requirements, and Acceptance Criteria before task.py start.",
            source="plan_gate",
        )

    try:
        content = prd_path.read_text(encoding="utf-8")
    except OSError as exc:
        return GateResult(
            allowed=False,
            status="blocked",
            summary="Plan/Intent could not be read.",
            blockers=[str(exc)],
            next_step="Fix prd.md permissions or encoding, then rerun task.py start.",
            source="plan_gate",
        )

    sections = _extract_h2_sections(content)
    required_sections = _configured_required_sections(plan_gate)
    if _is_intent_document_required(plan_gate):
        # Older configs listed `Intent` under prd.md required_sections. Once
        # intent.md is enabled, that section belongs to the Intent document so
        # existing projects do not have to rewrite local config immediately.
        required_sections = [
            section
            for section in required_sections
            if _normalize_heading(section).lower() != "intent"
        ]

    for section in required_sections:
        key = _normalize_heading(section)
        body = sections.get(key)
        if body is None:
            blockers.append(f"Missing required prd.md section: ## {section}")
        elif not _section_has_meaningful_content(body):
            blockers.append(f"Required prd.md section is still empty/TBD: ## {section}")

    require_risk = _is_true(plan_gate.get("require_risk"))
    if require_risk:
        risk_body = sections.get("risk") or sections.get("risk level")
        if risk_body is None:
            blockers.append("Missing required prd.md section: ## Risk")
        elif not re.search(r"\b(low|medium|high|critical)\b", risk_body, re.IGNORECASE):
            blockers.append("Risk section must declare one of: Low, Medium, High, Critical")

    if blockers:
        return GateResult(
            allowed=False,
            status="blocked",
            summary="Plan/Intent gate blocked task_start.",
            blockers=blockers,
            next_step="Complete prd.md in Phase 1 before activating the task. Only readonly research and Intent/Plan drafting are allowed before start.",
            source="plan_gate",
        )

    return GateResult(
        allowed=True,
        status="ready",
        summary="Plan/Intent gate passed.",
        blockers=[],
        source="plan_gate",
    )


def _result_from_command(
    command: str,
    *,
    event: str,
    repo_root: Path,
    message: str | None,
    task_dir: str | None,
) -> GateResult:
    env = os.environ.copy()
    env["TRELLIS_GOVERNANCE_EVENT"] = event
    env["TRELLIS_GATE_EVENT"] = event
    if message:
        env["TRELLIS_GATE_MESSAGE"] = message
    if task_dir:
        env["TRELLIS_TASK_DIR"] = task_dir

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
        return GateResult(
            allowed=False,
            status="blocked",
            summary=f"Governance command timed out: {command}",
            blockers=["Governance evaluator timed out."],
            source="command",
        )

    stdout = result.stdout.strip()
    stderr = result.stderr.strip()
    payload: dict | None = None
    if stdout:
        try:
            parsed = json.loads(stdout)
            if isinstance(parsed, dict):
                payload = parsed
        except json.JSONDecodeError:
            payload = None

    if payload is not None:
        gate = _result_from_payload(
            payload,
            default_allowed=result.returncode == 0,
            source="command",
        )
        if result.returncode != 0:
            gate.allowed = False
        if stderr and not gate.blockers:
            gate.blockers = [stderr]
        return gate

    if result.returncode == 0:
        return GateResult(
            allowed=True,
            status="ready",
            summary=stdout or "Governance command passed.",
            blockers=[],
            source="command",
        )

    return GateResult(
        allowed=False,
        status="blocked",
        summary=stdout or stderr or f"Governance command failed: {command}",
        blockers=[stderr] if stderr else [],
        source="command",
    )


def evaluate_governance_gate(
    event: str,
    *,
    message: str | None = None,
    task_dir: str | None = None,
    repo_root: Path | None = None,
) -> GateResult:
    """Evaluate the configured governance gate for an event."""
    if repo_root is None:
        repo_root = get_repo_root()

    if not is_governance_event_enforced(event, repo_root):
        return GateResult(
            allowed=True,
            status="not_required",
            summary=f"Governance gate is not enforced for {event}.",
            blockers=[],
        )

    command = get_governance_command(repo_root)
    if command:
        return _result_from_command(
            command,
            event=event,
            repo_root=repo_root,
            message=message,
            task_dir=task_dir,
        )

    if event == "task_start" and _is_plan_gate_enabled(repo_root):
        return _result_from_plan_gate(repo_root, task_dir)

    return _result_from_session_gate(repo_root)


def format_gate_block(event: str, gate: GateResult) -> str:
    lines = [
        f"Governance gate blocked {event}.",
        f"Status: {gate.status.upper()}",
        f"Summary: {gate.summary}",
    ]
    if gate.blockers:
        lines.append("Blockers:")
        for blocker in gate.blockers:
            lines.append(f"- {blocker}")
    if gate.next_step:
        lines.append(f"Next: {gate.next_step}")
    return "\n".join(lines)


def enforce_governance_gate(
    event: str,
    *,
    message: str | None = None,
    task_dir: str | None = None,
    repo_root: Path | None = None,
    stream=None,
) -> bool:
    """Return True when the action may continue; print a blocker otherwise."""
    gate = evaluate_governance_gate(
        event,
        message=message,
        task_dir=task_dir,
        repo_root=repo_root,
    )
    if gate.allowed:
        return True
    print(format_gate_block(event, gate), file=stream or sys.stderr)
    return False
