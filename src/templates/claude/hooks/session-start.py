#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Session Start Hook - Inject structured context."""

from __future__ import annotations

import warnings

warnings.filterwarnings("ignore")

import json
import os
import subprocess
import sys
from io import StringIO
from pathlib import Path

if sys.platform == "win32":
    import io as _io

    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[union-attr]
    elif hasattr(sys.stdout, "detach"):
        sys.stdout = _io.TextIOWrapper(sys.stdout.detach(), encoding="utf-8", errors="replace")  # type: ignore[union-attr]


def should_skip_injection() -> bool:
    return (
        os.environ.get("CLAUDE_NON_INTERACTIVE") == "1"
        or os.environ.get("OPENCODE_NON_INTERACTIVE") == "1"
    )


def read_file(path: Path, fallback: str = "") -> str:
    try:
        return path.read_text(encoding="utf-8")
    except (FileNotFoundError, PermissionError):
        return fallback


def run_script(script_path: Path, *args: str) -> str:
    if not script_path.is_file():
        return ""

    try:
        env = os.environ.copy()
        env["PYTHONIOENCODING"] = "utf-8"
        cmd = [sys.executable, "-W", "ignore", str(script_path), *args]
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=5,
            cwd=script_path.parent.parent.parent,
            env=env,
        )
        return result.stdout if result.returncode == 0 else ""
    except (subprocess.TimeoutExpired, FileNotFoundError, PermissionError):
        return ""


def _normalize_task_ref(task_ref: str) -> str:
    normalized = task_ref.strip()
    if not normalized:
        return ""

    path_obj = Path(normalized)
    if path_obj.is_absolute():
        return str(path_obj)

    normalized = normalized.replace("\\", "/")
    while normalized.startswith("./"):
        normalized = normalized[2:]

    if normalized.startswith("tasks/"):
        return f".trellis/{normalized}"

    return normalized


def _resolve_task_dir(trellis_dir: Path, task_ref: str) -> Path:
    normalized = _normalize_task_ref(task_ref)
    path_obj = Path(normalized)
    if path_obj.is_absolute():
        return path_obj
    if normalized.startswith(".trellis/"):
        return trellis_dir.parent / path_obj
    return trellis_dir / "tasks" / path_obj


def _get_task_status(trellis_dir: Path) -> str:
    current_task_file = trellis_dir / ".current-task"
    if not current_task_file.is_file():
        return "Status: NO ACTIVE TASK\nNext: Describe what you want to work on"

    task_ref = _normalize_task_ref(current_task_file.read_text(encoding="utf-8").strip())
    if not task_ref:
        return "Status: NO ACTIVE TASK\nNext: Describe what you want to work on"

    task_dir = _resolve_task_dir(trellis_dir, task_ref)
    if not task_dir.is_dir():
        return f"Status: STALE POINTER\nTask: {task_ref}\nNext: Task directory not found. Run: python3 ./.trellis/scripts/task.py finish"

    task_json_path = task_dir / "task.json"
    task_data = {}
    if task_json_path.is_file():
        try:
            task_data = json.loads(task_json_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, PermissionError):
            pass

    task_title = task_data.get("title", task_ref)
    task_status = task_data.get("status", "unknown")

    if task_status == "completed":
        return f"Status: COMPLETED\nTask: {task_title}\nNext: Archive with `python3 ./.trellis/scripts/task.py archive {task_dir.name}` or start a new task"

    has_context = False
    for jsonl_name in ("implement.jsonl", "check.jsonl", "spec.jsonl"):
        jsonl_path = task_dir / jsonl_name
        if jsonl_path.is_file() and jsonl_path.stat().st_size > 0:
            has_context = True
            break

    has_prd = (task_dir / "prd.md").is_file()

    if not has_prd:
        return f"Status: NOT READY\nTask: {task_title}\nMissing: prd.md not created\nNext: Write PRD, then research → init-context → start"

    if not has_context:
        return f"Status: NOT READY\nTask: {task_title}\nMissing: Context not configured (no jsonl files)\nNext: Complete Phase 2 (research → init-context → start) before implementing"

    return f"Status: READY\nTask: {task_title}\nNext: Continue with implement or check"


def _load_trellis_config(trellis_dir: Path) -> tuple[bool, dict, object, str | None, str | None]:
    scripts_dir = trellis_dir / "scripts"
    if str(scripts_dir) not in sys.path:
        sys.path.insert(0, str(scripts_dir))

    try:
        from common.config import get_default_package, get_packages, get_spec_scope, is_monorepo  # type: ignore[import-not-found]
        from common.paths import get_current_task  # type: ignore[import-not-found]

        repo_root = trellis_dir.parent
        is_mono = is_monorepo(repo_root)
        packages = get_packages(repo_root) or {}
        scope = get_spec_scope(repo_root)

        task_pkg = None
        current = get_current_task(repo_root)
        if current:
            task_json = repo_root / current / "task.json"
            if task_json.is_file():
                try:
                    data = json.loads(task_json.read_text(encoding="utf-8"))
                    if isinstance(data, dict):
                        candidate = data.get("package")
                        if isinstance(candidate, str) and candidate:
                            task_pkg = candidate
                except (json.JSONDecodeError, OSError):
                    pass

        default_pkg = get_default_package(repo_root)
        return is_mono, packages, scope, task_pkg, default_pkg
    except Exception:
        return False, {}, None, None, None


def _check_legacy_spec(trellis_dir: Path, is_mono: bool, packages: dict) -> str | None:
    if not is_mono or not packages:
        return None

    spec_dir = trellis_dir / "spec"
    if not spec_dir.is_dir():
        return None

    has_legacy = False
    for legacy_name in ("backend", "frontend"):
        legacy_dir = spec_dir / legacy_name
        if legacy_dir.is_dir() and (legacy_dir / "index.md").is_file():
            has_legacy = True
            break

    if not has_legacy:
        return None

    missing = [name for name in sorted(packages.keys()) if not (spec_dir / name).is_dir()]
    if not missing:
        return None

    if len(missing) == len(packages):
        return (
            "[!] Legacy spec structure detected: found `spec/backend/` or `spec/frontend/` "
            "but no package-scoped `spec/<package>/` directories.\n"
            f"Monorepo packages: {', '.join(sorted(packages.keys()))}\n"
            "Please reorganize: `spec/backend/` -> `spec/<package>/backend/`"
        )

    return (
        f"[!] Partial spec migration detected: packages {', '.join(missing)} "
        "still missing `spec/<pkg>/` directory.\n"
        "Please complete migration for all packages."
    )


def _resolve_spec_scope(
    is_mono: bool,
    packages: dict,
    scope: object,
    task_pkg: str | None,
    default_pkg: str | None,
) -> set[str] | None:
    if not is_mono or not packages:
        return None

    if scope is None:
        return None

    if isinstance(scope, str) and scope == "active_task":
        if task_pkg and task_pkg in packages:
            return {task_pkg}
        if default_pkg and default_pkg in packages:
            return {default_pkg}
        return None

    if isinstance(scope, list):
        valid = {entry for entry in scope if entry in packages}
        if valid:
            return valid
        if task_pkg and task_pkg in packages:
            return {task_pkg}
        if default_pkg and default_pkg in packages:
            return {default_pkg}
        return None

    return None


def _build_workflow_toc(workflow_path: Path) -> str:
    content = read_file(workflow_path)
    if not content:
        return "No workflow.md found"

    toc_lines = [
        "# Development Workflow — Section Index",
        "Full guide: .trellis/workflow.md (read on demand)",
        "",
    ]
    for line in content.splitlines():
        if line.startswith("## "):
            toc_lines.append(line)

    toc_lines += [
        "",
        "To read a section: use the Read tool on .trellis/workflow.md",
    ]
    return "\n".join(toc_lines)


def _load_session_gate_summary(trellis_dir: Path) -> str | None:
    gate_script = trellis_dir / "scripts" / "session_gate.py"
    raw = run_script(gate_script, "show", "--json")
    if not raw:
        return None

    try:
        state = json.loads(raw)
    except json.JSONDecodeError:
        return None

    status = str(state.get("status", "not_evaluated"))
    if status == "not_evaluated":
        return None

    lines = [f"Status: {status.upper()}"]

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


def _append_index(output: StringIO, title: str, index_file: Path) -> bool:
    content = read_file(index_file)
    if not content:
        return False
    output.write(f"## {title}\n")
    output.write(content)
    output.write("\n\n")
    return True


def _write_guideline_indexes(output: StringIO, spec_dir: Path, allowed_pkgs: set[str] | None) -> None:
    has_content = False
    if not spec_dir.is_dir():
        output.write("Not configured")
        return

    root_index = spec_dir / "index.md"
    if root_index.is_file():
        has_content = _append_index(output, "spec", root_index) or has_content

    guides_index = spec_dir / "guides" / "index.md"
    if guides_index.is_file():
        has_content = _append_index(output, "guides", guides_index) or has_content

    for top_level in sorted(spec_dir.iterdir(), key=lambda path: path.name):
        if not top_level.is_dir() or top_level.name.startswith(".") or top_level.name == "guides":
            continue

        top_index = top_level / "index.md"
        if top_index.is_file():
            has_content = _append_index(output, top_level.name, top_index) or has_content
            for child in sorted(top_level.iterdir(), key=lambda path: path.name):
                if not child.is_dir() or child.name.startswith("."):
                    continue
                child_index = child / "index.md"
                if child_index.is_file():
                    has_content = _append_index(output, f"{top_level.name}/{child.name}", child_index) or has_content
            continue

        if allowed_pkgs is not None and top_level.name not in allowed_pkgs:
            continue

        for child in sorted(top_level.iterdir(), key=lambda path: path.name):
            if not child.is_dir() or child.name.startswith("."):
                continue
            child_index = child / "index.md"
            if child_index.is_file():
                has_content = _append_index(output, f"{top_level.name}/{child.name}", child_index) or has_content

    if not has_content:
        output.write("Not configured")


def main() -> None:
    if should_skip_injection():
        sys.exit(0)

    project_dir = Path(os.environ.get("CLAUDE_PROJECT_DIR", ".")).resolve()
    trellis_dir = project_dir / ".trellis"

    is_mono, packages, scope_config, task_pkg, default_pkg = _load_trellis_config(trellis_dir)
    allowed_pkgs = _resolve_spec_scope(is_mono, packages, scope_config, task_pkg, default_pkg)

    output = StringIO()
    output.write(
        """<session-context>
You are starting a new session in a Trellis-managed project.
Read and follow all instructions below carefully.
</session-context>

"""
    )

    legacy_warning = _check_legacy_spec(trellis_dir, is_mono, packages)
    if legacy_warning:
        output.write(f"<migration-warning>\n{legacy_warning}\n</migration-warning>\n\n")

    context_script = trellis_dir / "scripts" / "get_context.py"
    context_output = run_script(context_script)
    if context_output:
        output.write("<current-state>\n")
        output.write(context_output.rstrip())
        output.write("\n</current-state>\n\n")

    gate_summary = _load_session_gate_summary(trellis_dir)
    if gate_summary:
        output.write("<session-gate>\n")
        output.write(gate_summary)
        output.write("\n</session-gate>\n\n")

    output.write("<workflow>\n")
    output.write(_build_workflow_toc(trellis_dir / "workflow.md"))
    output.write("\n</workflow>\n\n")

    output.write("<guidelines>\n")
    output.write(
        "These are guideline indexes only. Read the specific files they reference before implementation.\n\n"
    )
    _write_guideline_indexes(output, trellis_dir / "spec", allowed_pkgs)
    output.write("\n</guidelines>\n\n")

    task_status = _get_task_status(trellis_dir)
    output.write(f"<task-status>\n{task_status}\n</task-status>\n\n")

    output.write(
        """<ready>
Context loaded. Workflow index, project state, guideline indexes, and any persisted session gate state are already injected above.
Wait for the user's first message, then follow the workflow.
If there is an active task, ask whether to continue it.
</ready>"""
    )

    result = {
        "hookSpecificOutput": {
            "hookEventName": "SessionStart",
            "additionalContext": output.getvalue(),
        }
    }
    print(json.dumps(result, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
