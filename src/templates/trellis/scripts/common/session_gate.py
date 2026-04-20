#!/usr/bin/env python3
"""
Session gate state helpers.

Persists the current rule-review result for the active developer so
`/trellis:start` and follow-up turns can continue from the same blocker.
"""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path

from .config import get_default_package, get_packages, get_spec_scope
from .paths import get_current_task, get_developer, get_repo_root, get_workspace_dir


GATE_FILE = "session-gate.json"
DEFAULT_SUMMARY = "Review applicable rule indexes before task creation or implementation."
DEFAULT_NEXT_STEP = "Read the listed rule indexes, decide whether progress is blocked, then persist the result with session_gate.py set."


def _now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def get_gate_file(repo_root: Path | None = None) -> Path | None:
    if repo_root is None:
        repo_root = get_repo_root()

    workspace_dir = get_workspace_dir(repo_root)
    if workspace_dir is None:
        return None
    return workspace_dir / GATE_FILE


def load_gate_state(repo_root: Path | None = None) -> dict | None:
    gate_file = get_gate_file(repo_root)
    if gate_file is None or not gate_file.is_file():
        return None

    try:
        data = json.loads(gate_file.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None

    if isinstance(data, dict):
        return data
    return None


def save_gate_state(state: dict, repo_root: Path | None = None) -> bool:
    gate_file = get_gate_file(repo_root)
    if gate_file is None:
        return False

    try:
        gate_file.parent.mkdir(parents=True, exist_ok=True)
        gate_file.write_text(
            json.dumps(state, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
        return True
    except OSError:
        return False


def clear_gate_state(repo_root: Path | None = None) -> bool:
    gate_file = get_gate_file(repo_root)
    if gate_file is None:
        return False

    try:
        if gate_file.is_file():
            gate_file.unlink()
        return True
    except OSError:
        return False


def _message_mentions_testing(message: str) -> bool:
    lowered = message.lower()
    keywords = (
        "test",
        "testing",
        "qa",
        "regression",
        "e2e",
        "unit test",
        "integration test",
        "测试",
        "回归",
        "验收",
    )
    return any(keyword in lowered for keyword in keywords)


def classify_request(message: str) -> str:
    lowered = message.strip().lower()
    if not lowered:
        return "unknown"

    trivial_keywords = (
        "typo",
        "comment",
        "readme",
        "docs only",
        "文案",
        "错别字",
        "注释",
        "只改文档",
    )
    if any(keyword in lowered for keyword in trivial_keywords):
        return "trivial"

    development_keywords = (
        "implement",
        "add ",
        "fix",
        "refactor",
        "update",
        "feature",
        "bug",
        "build",
        "开发",
        "实现",
        "修改",
        "修复",
        "重构",
        "新增",
        "优化",
    )
    if any(keyword in lowered for keyword in development_keywords):
        return "development"

    question_keywords = (
        "what",
        "why",
        "how",
        "explain",
        "介绍",
        "原理",
        "是什么",
        "为什么",
        "怎么",
        "是否",
        "吗",
        "？",
        "?",
    )
    if any(keyword in lowered for keyword in question_keywords):
        return "question"

    return "unknown"


def _get_active_task_package(repo_root: Path) -> str | None:
    current_task = get_current_task(repo_root)
    if not current_task:
        return None

    task_json = repo_root / current_task / "task.json"
    if not task_json.is_file():
        return None

    try:
        data = json.loads(task_json.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None

    package = data.get("package")
    if isinstance(package, str) and package:
        return package
    return None


def _resolve_scope_set(
    packages: dict[str, dict],
    spec_scope: list[str] | str | None,
    task_package: str | None,
    default_package: str | None,
) -> set[str] | None:
    if not packages:
        return None

    if spec_scope is None:
        return None

    if isinstance(spec_scope, str) and spec_scope == "active_task":
        if task_package and task_package in packages:
            return {task_package}
        if default_package and default_package in packages:
            return {default_package}
        return None

    if isinstance(spec_scope, list):
        valid = {entry for entry in spec_scope if entry in packages}
        if valid:
            return valid
        if task_package and task_package in packages:
            return {task_package}
        if default_package and default_package in packages:
            return {default_package}
        return None

    return None


def _discover_single_repo_indexes(spec_root: Path) -> list[str]:
    docs: list[str] = []
    if not spec_root.is_dir():
        return docs

    root_index = spec_root / "index.md"
    if root_index.is_file():
        docs.append(".trellis/spec/index.md")

    guides_index = spec_root / "guides" / "index.md"
    if guides_index.is_file():
        docs.append(".trellis/spec/guides/index.md")

    for child in sorted(spec_root.iterdir(), key=lambda path: path.name):
        if not child.is_dir() or child.name.startswith(".") or child.name == "guides":
            continue
        index_file = child / "index.md"
        if index_file.is_file():
            docs.append(f".trellis/spec/{child.name}/index.md")

    return docs


def _discover_monorepo_indexes(spec_root: Path, message: str, repo_root: Path) -> list[str]:
    docs: list[str] = []
    packages = get_packages(repo_root) or {}
    default_package = get_default_package(repo_root)
    task_package = _get_active_task_package(repo_root)
    scope = _resolve_scope_set(packages, get_spec_scope(repo_root), task_package, default_package)

    explicit_packages = [
        package_name
        for package_name in sorted(packages.keys())
        if re.search(rf"(?<![A-Za-z0-9_-]){re.escape(package_name)}(?![A-Za-z0-9_-])", message)
    ]

    if explicit_packages:
        selected_packages = explicit_packages
    elif scope is not None:
        selected_packages = sorted(scope)
    elif task_package and task_package in packages:
        selected_packages = [task_package]
    elif default_package and default_package in packages:
        selected_packages = [default_package]
    else:
        selected_packages = sorted(packages.keys())

    guides_index = spec_root / "guides" / "index.md"
    if guides_index.is_file():
        docs.append(".trellis/spec/guides/index.md")

    for top_level in sorted(spec_root.iterdir(), key=lambda path: path.name):
        if not top_level.is_dir() or top_level.name.startswith(".") or top_level.name == "guides":
            continue

        top_index = top_level / "index.md"
        if top_index.is_file():
            docs.append(f".trellis/spec/{top_level.name}/index.md")
            for child in sorted(top_level.iterdir(), key=lambda path: path.name):
                if not child.is_dir() or child.name.startswith("."):
                    continue
                child_index = child / "index.md"
                if child_index.is_file():
                    docs.append(f".trellis/spec/{top_level.name}/{child.name}/index.md")
            continue

        if top_level.name not in selected_packages:
            continue

        for child in sorted(top_level.iterdir(), key=lambda path: path.name):
            if not child.is_dir() or child.name.startswith("."):
                continue
            if child.name == "testing" and not _message_mentions_testing(message):
                continue
            child_index = child / "index.md"
            if child_index.is_file():
                docs.append(f".trellis/spec/{top_level.name}/{child.name}/index.md")

    deduped: list[str] = []
    seen: set[str] = set()
    for item in docs:
        if item not in seen:
            deduped.append(item)
            seen.add(item)
    return deduped


def discover_rule_indexes(message: str, repo_root: Path | None = None) -> list[str]:
    if repo_root is None:
        repo_root = get_repo_root()

    spec_root = repo_root / ".trellis" / "spec"
    if not spec_root.is_dir():
        return []

    packages = get_packages(repo_root)
    if packages:
        return _discover_monorepo_indexes(spec_root, message, repo_root)
    return _discover_single_repo_indexes(spec_root)


def default_gate_state(repo_root: Path | None = None) -> dict:
    developer = get_developer(repo_root) or ""
    return {
        "version": 1,
        "status": "not_evaluated",
        "developer": developer,
        "taskType": "unknown",
        "request": "",
        "summary": "No rule review recorded for this developer yet.",
        "blockers": [],
        "applicableDocs": [],
        "nextStep": "Run python3 ./.trellis/scripts/session_gate.py inspect --message \"<request summary>\" before creating a task.",
        "updatedAt": None,
    }


def inspect_request(message: str, repo_root: Path | None = None) -> dict:
    if repo_root is None:
        repo_root = get_repo_root()

    developer = get_developer(repo_root)
    docs = discover_rule_indexes(message, repo_root)
    task_type = classify_request(message)

    if not developer:
        state = {
            "version": 1,
            "status": "blocked",
            "developer": "",
            "taskType": task_type,
            "request": message,
            "summary": "Developer identity is not initialized.",
            "blockers": [
                "Run python3 ./.trellis/scripts/init_developer.py <name> before evaluating session rules.",
            ],
            "applicableDocs": docs,
            "nextStep": "Initialize developer identity, then rerun session_gate.py inspect.",
            "updatedAt": _now_iso(),
        }
        save_gate_state(state, repo_root)
        return state

    if task_type in {"question", "trivial"}:
        state = {
            "version": 1,
            "status": "not_required",
            "developer": developer,
            "taskType": task_type,
            "request": message,
            "summary": "No blocking rule review is required for this request type.",
            "blockers": [],
            "applicableDocs": docs,
            "nextStep": "Answer directly or make the trivial edit. Re-run inspect if the request changes into development work.",
            "updatedAt": _now_iso(),
        }
        save_gate_state(state, repo_root)
        return state

    if not docs:
        state = {
            "version": 1,
            "status": "ready",
            "developer": developer,
            "taskType": task_type,
            "request": message,
            "summary": "No additional rule indexes were discovered for this request.",
            "blockers": [],
            "applicableDocs": [],
            "nextStep": "Proceed with normal Trellis classification and task workflow.",
            "updatedAt": _now_iso(),
        }
        save_gate_state(state, repo_root)
        return state

    state = {
        "version": 1,
        "status": "needs_review",
        "developer": developer,
        "taskType": task_type,
        "request": message,
        "summary": DEFAULT_SUMMARY,
        "blockers": [],
        "applicableDocs": docs,
        "nextStep": DEFAULT_NEXT_STEP,
        "updatedAt": _now_iso(),
    }
    save_gate_state(state, repo_root)
    return state


def set_gate_result(
    status: str,
    summary: str,
    *,
    blockers: list[str] | None = None,
    docs: list[str] | None = None,
    next_step: str | None = None,
    request: str | None = None,
    task_type: str | None = None,
    repo_root: Path | None = None,
) -> dict:
    if repo_root is None:
        repo_root = get_repo_root()

    previous = load_gate_state(repo_root) or default_gate_state(repo_root)
    state = {
        "version": 1,
        "status": status,
        "developer": get_developer(repo_root) or previous.get("developer", ""),
        "taskType": task_type or previous.get("taskType", "unknown"),
        "request": request if request is not None else previous.get("request", ""),
        "summary": summary,
        "blockers": blockers or [],
        "applicableDocs": docs if docs is not None else previous.get("applicableDocs", []),
        "nextStep": next_step or previous.get("nextStep") or DEFAULT_NEXT_STEP,
        "updatedAt": _now_iso(),
    }
    save_gate_state(state, repo_root)
    return state


def summarize_gate_state(state: dict | None) -> str:
    if not state:
        state = default_gate_state()

    lines = [f"Status: {str(state.get('status', 'not_evaluated')).upper()}"]

    task_type = state.get("taskType")
    if task_type:
        lines.append(f"Task type: {task_type}")

    request = state.get("request")
    if request:
        lines.append(f"Request: {request}")

    summary = state.get("summary")
    if summary:
        lines.append(f"Summary: {summary}")

    docs = state.get("applicableDocs") or []
    if docs:
        lines.append("Docs:")
        for item in docs:
            lines.append(f"- {item}")

    blockers = state.get("blockers") or []
    if blockers:
        lines.append("Blockers:")
        for blocker in blockers:
            lines.append(f"- {blocker}")

    next_step = state.get("nextStep")
    if next_step:
        lines.append(f"Next: {next_step}")

    updated_at = state.get("updatedAt")
    if updated_at:
        lines.append(f"Updated: {updated_at}")

    return "\n".join(lines)


def state_as_json(state: dict | None, repo_root: Path | None = None) -> dict:
    if state:
        return state
    return default_gate_state(repo_root)
