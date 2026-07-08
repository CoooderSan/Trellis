#!/usr/bin/env python3
"""Runtime governance gate enforcement.

Trellis owns the workflow choke points. Team-specific policy can live in
external specs or an executable adapter configured in .trellis/config.yaml.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

from .config import (
    get_governance_command,
    is_governance_event_enforced,
)
from .paths import get_repo_root
from .session_gate import load_gate_state, summarize_gate_state


PASS_STATUSES = {"ready", "not_required"}


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
