#!/usr/bin/env python3
"""
Task JSONL context management.

Provides:
    cmd_add_context   - Add entry to JSONL context file
    cmd_validate      - Validate JSONL context files
    cmd_list_context  - List JSONL context entries

Note:
    ``cmd_init_context`` was removed in v0.5.0-beta.12. JSONL context files
    are now seeded at ``task.py create`` time with a self-describing
    ``_example`` line; the AI agent curates real entries during planning when
    the task needs sub-agent/spec context. See ``.trellis/workflow.md`` for the
    current planning artifact contract.
"""

from __future__ import annotations

import argparse
import json
import stat
import sys
from pathlib import Path

from .config import get_context_injection_limits
from .git import branch_exists_locally
from .io import read_json
from .log import Colors, colored
from .paths import DIR_ARCHIVE, DIR_TASKS, DIR_WORKFLOW, FILE_TASK_JSON, get_repo_root
from .task_utils import resolve_task_dir

# Extensions that look like code rather than spec/research docs. Entries with
# one of these extensions outside .trellis/spec/, docs/docs-site, or the
# task's own directory get a hygiene warning in `task.py validate` — the
# reader is a sub-agent, not a human, so code paths belong in the diff the
# agent reads itself, not in implement.jsonl / check.jsonl.
_CODE_FILE_EXTENSIONS = {
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".mjs",
    ".cjs",
    ".py",
    ".go",
    ".rs",
    ".java",
    ".rb",
    ".c",
    ".cc",
    ".cpp",
    ".h",
}


# =============================================================================
# Command: add-context
# =============================================================================

def cmd_add_context(args: argparse.Namespace) -> int:
    """Add entry to JSONL context file."""
    repo_root = get_repo_root()
    target_dir = resolve_task_dir(args.dir, repo_root)

    jsonl_name = args.file
    path = args.path
    reason = args.reason or "Added manually"

    if not target_dir.is_dir():
        print(colored(f"Error: Directory not found: {target_dir}", Colors.RED))
        return 1

    # Support shorthand
    if not jsonl_name.endswith(".jsonl"):
        jsonl_name = f"{jsonl_name}.jsonl"

    jsonl_file = target_dir / jsonl_name
    full_path = repo_root / path

    entry_type = "file"
    if full_path.is_dir():
        entry_type = "directory"
        if not path.endswith("/"):
            path = f"{path}/"
    elif not full_path.is_file():
        print(colored(f"Error: Path not found: {path}", Colors.RED))
        return 1

    # Check if already exists
    if jsonl_file.is_file():
        content = jsonl_file.read_text(encoding="utf-8")
        if f'"{path}"' in content:
            print(colored(f"Warning: Entry already exists for {path}", Colors.YELLOW))
            return 0

    # Add entry
    entry: dict
    if entry_type == "directory":
        entry = {"file": path, "type": "directory", "reason": reason}
    else:
        entry = {"file": path, "reason": reason}

    with jsonl_file.open("a", encoding="utf-8") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")

    print(colored(f"Added {entry_type}: {path}", Colors.GREEN))
    return 0


# =============================================================================
# Command: validate
# =============================================================================

def cmd_validate(args: argparse.Namespace) -> int:
    """Validate JSONL context files."""
    repo_root = get_repo_root()
    target_dir = resolve_task_dir(args.dir, repo_root)

    if not target_dir.is_dir():
        print(colored("Error: task directory required", Colors.RED))
        return 1

    print(colored("=== Validating Context Files ===", Colors.BLUE))
    print(f"Target dir: {target_dir}")
    print()

    # Warn (don't fail validation) when the recorded branch is stale — it
    # was likely already merged and deleted (#399 item 2).
    task_json_path = target_dir / FILE_TASK_JSON
    if task_json_path.is_file():
        task_data = read_json(task_json_path)
        stored_branch = task_data.get("branch") if task_data else None
        if stored_branch and not branch_exists_locally(stored_branch, repo_root):
            print(
                colored(
                    f"Warning: recorded branch '{stored_branch}' no longer exists locally "
                    "(likely merged and deleted).",
                    Colors.YELLOW,
                )
            )
            print()

    total_errors = 0
    for jsonl_name in ["implement.jsonl", "check.jsonl"]:
        jsonl_file = target_dir / jsonl_name
        errors = _validate_jsonl(jsonl_file, repo_root, target_dir)
        total_errors += errors

    print()
    if total_errors == 0:
        print(colored("✓ All validations passed", Colors.GREEN))
        return 0
    else:
        print(colored(f"✗ Validation failed ({total_errors} errors)", Colors.RED))
        return 1


def _is_exempt_from_code_file_warning(file_path: str, task_rel: str) -> bool:
    """Whether a jsonl entry path is exempt from the code-file hygiene warning.

    Exempt: spec docs (``.trellis/spec/``), documentation (``docs``,
    ``docs-site``), and the task's own directory (execution plans, generated
    artifacts, etc. legitimately live there).
    """
    posix_path = file_path.replace("\\", "/").lstrip("/")
    exempt_prefixes = (".trellis/spec/", "docs/", "docs-site/")
    if posix_path.startswith(exempt_prefixes):
        return True
    if task_rel and (posix_path == task_rel or posix_path.startswith(f"{task_rel}/")):
        return True
    return False


def _resolved_archived_task_root(repo_root: Path, task_dir: Path | None) -> Path | None:
    """Return the canonical archived task root, or ``None`` for live tasks."""
    if task_dir is None:
        return None

    try:
        repo_root_resolved = repo_root.resolve()
        task_dir_resolved = task_dir.resolve()
        task_parts = task_dir_resolved.relative_to(repo_root_resolved).parts
    except (OSError, RuntimeError, ValueError):
        return None

    archive_prefix = (DIR_WORKFLOW, DIR_TASKS, DIR_ARCHIVE)
    if len(task_parts) != 5 or task_parts[:3] != archive_prefix:
        return None

    year_month = task_parts[3]
    if (
        len(year_month) != 7
        or year_month[4] != "-"
        or not year_month[:4].isdigit()
        or not year_month[5:].isdigit()
    ):
        return None
    return task_dir_resolved


def _resolve_context_entry_path(
    file_path: str, repo_root: Path, task_dir: Path | None
) -> Path | None:
    """Resolve a JSONL entry, binding archived self-references to the archive copy.

    Exact historical self-references are remapped only for archived tasks.
    ``None`` means the remapped path traversed or resolved outside that archive.
    """
    repo_path = repo_root / file_path
    archive_root = _resolved_archived_task_root(repo_root, task_dir)
    if archive_root is None:
        return repo_path

    historical_root = f"{DIR_WORKFLOW}/{DIR_TASKS}/{archive_root.name}"
    posix_path = file_path.replace("\\", "/")
    if posix_path == historical_root:
        relative_parts: tuple[str, ...] = ()
    elif posix_path.startswith(f"{historical_root}/"):
        relative_path = posix_path[len(historical_root) + 1 :]
        if relative_path.endswith("/"):
            relative_path = relative_path[:-1]
        relative_parts = tuple(relative_path.split("/")) if relative_path else ()
        if any(part in ("", ".", "..") for part in relative_parts):
            return None
    else:
        return repo_path

    try:
        resolved_path = archive_root.joinpath(*relative_parts).resolve()
        resolved_path.relative_to(archive_root)
    except (OSError, RuntimeError, ValueError):
        return None
    return resolved_path


def _resolve_context_directory_files(
    entry_path: Path,
    repo_root: Path,
    task_dir: Path | None,
) -> list[tuple[str, Path]]:
    """Resolve direct Markdown children without escaping an archived task.

    Directory manifests are intentionally non-recursive. For an archived task,
    every candidate child is canonicalized before it is classified as a file;
    a symlink to a file or directory outside the archive invalidates the whole
    entry instead of leaking that target into injected context.
    """
    entry_root = entry_path.resolve(strict=True)
    archive_root = _resolved_archived_task_root(repo_root, task_dir)
    enforce_archive = False
    if archive_root is not None:
        try:
            entry_root.relative_to(archive_root)
            enforce_archive = True
        except ValueError:
            pass

    files: list[tuple[str, Path]] = []
    for child in entry_root.iterdir():
        if not child.name.endswith(".md"):
            continue
        try:
            resolved_child = child.resolve(strict=True)
        except (OSError, RuntimeError):
            # Broken/unresolvable children cannot be materialized and are safe
            # to ignore, matching the previous non-file behavior.
            continue
        if enforce_archive and archive_root is not None:
            try:
                resolved_child.relative_to(archive_root)
            except ValueError as exc:
                raise ValueError(
                    "referenced path escapes the task archive"
                ) from exc
        if resolved_child.is_file():
            # Preserve the manifest-visible child name while materializing the
            # canonical path. This keeps internal symlink aliases readable
            # without reopening the checked symlink during content loading.
            files.append((child.name, resolved_child))
    return sorted(files, key=lambda item: item[0])


def _validate_jsonl(jsonl_file: Path, repo_root: Path, task_dir: Path | None = None) -> int:
    """Validate a single JSONL file.

    Seed rows (no ``file`` field — typically ``{"_example": "..."}``) are
    skipped silently; they are self-describing comments, not real entries.

    Beyond hard errors (missing file/dir, invalid JSON), this also prints
    non-blocking hygiene warnings (never counted in ``errors``, never change
    the exit code): entries that look like code files rather than
    spec/research docs, and entries whose file size exceeds the configured
    sub-agent context injection cap (``context_injection.max_file_bytes``).
    """
    file_name = jsonl_file.name
    errors = 0

    if not jsonl_file.is_file():
        print(f"  {colored(f'{file_name}: not found (skipped)', Colors.YELLOW)}")
        return 0

    task_rel = ""
    if task_dir is not None:
        try:
            task_rel = task_dir.resolve().relative_to(repo_root.resolve()).as_posix()
        except ValueError:
            task_rel = ""

    max_file_bytes = get_context_injection_limits(repo_root).get("max_file_bytes", 0)

    line_num = 0
    real_entries = 0
    for line in jsonl_file.read_text(encoding="utf-8").splitlines():
        line_num += 1
        if not line.strip():
            continue

        try:
            data = json.loads(line)
        except json.JSONDecodeError:
            print(f"  {colored(f'{file_name}:{line_num}: Invalid JSON', Colors.RED)}")
            errors += 1
            continue

        file_path = data.get("file")
        entry_type = data.get("type", "file")

        if not file_path:
            # Seed / comment row — skip silently
            continue

        real_entries += 1
        full_path = _resolve_context_entry_path(file_path, repo_root, task_dir)
        if entry_type == "directory":
            if full_path is None or not full_path.is_dir():
                print(f"  {colored(f'{file_name}:{line_num}: Directory not found: {file_path}', Colors.RED)}")
                errors += 1
            else:
                try:
                    _resolve_context_directory_files(full_path, repo_root, task_dir)
                except (OSError, RuntimeError, ValueError):
                    print(f"  {colored(f'{file_name}:{line_num}: Directory not found: {file_path}', Colors.RED)}")
                    errors += 1
            continue

        if full_path is None or not full_path.is_file():
            print(f"  {colored(f'{file_name}:{line_num}: File not found: {file_path}', Colors.RED)}")
            errors += 1
            continue

        extension = Path(file_path).suffix.lower()
        if extension in _CODE_FILE_EXTENSIONS and not _is_exempt_from_code_file_warning(
            file_path, task_rel
        ):
            warning_message = (
                f"{file_name}:{line_num}: Warning: {file_path} looks like a code file — "
                "implement/check.jsonl should reference spec/research docs; "
                "agents read code themselves"
            )
            print(f"  {colored(warning_message, Colors.YELLOW)}")

        if max_file_bytes:
            size = full_path.stat().st_size
            if size > max_file_bytes:
                warning_message = (
                    f"{file_name}:{line_num}: Warning: {file_path} is {size} bytes, "
                    f"exceeds context_injection.max_file_bytes ({max_file_bytes}); "
                    "injection will truncate it"
                )
                print(f"  {colored(warning_message, Colors.YELLOW)}")

    if errors == 0:
        print(f"  {colored(f'{file_name}: ✓ ({real_entries} entries)', Colors.GREEN)}")
    else:
        print(f"  {colored(f'{file_name}: ✗ ({errors} errors)', Colors.RED)}")

    return errors


def _readable_context_entry(
    entry_path: Path,
    entry_type: str,
    repo_root: Path,
    task_dir: Path | None,
) -> str | None:
    """Return an actionable error when a referenced context entry is unreadable."""
    try:
        permission_bits = entry_path.stat().st_mode
        if not permission_bits & (stat.S_IRUSR | stat.S_IRGRP | stat.S_IROTH):
            return "cannot be read: no read permission"
        if entry_type == "directory":
            if not entry_path.is_dir():
                return "directory does not exist"
            # Use the same archive-aware enumeration as context materialization.
            _resolve_context_directory_files(entry_path, repo_root, task_dir)
            return None
        if not entry_path.is_file():
            return "file does not exist"
        with entry_path.open("rb") as handle:
            handle.read(1)
        return None
    except ValueError as exc:
        return str(exc)
    except OSError as exc:
        return f"cannot be read: {exc}"


def validate_context_manifest_readiness(
    jsonl_file: Path,
    repo_root: Path,
    task_dir: Path | None = None,
) -> list[str]:
    """Validate one manifest as executable sub-agent dispatch context.

    Unlike ``task.py validate``, readiness is deliberately fail-closed:
    missing, empty, seed-only, malformed, entry-invalid, and unreadable
    manifests cannot be used to start or dispatch an implement/check agent.
    """
    file_name = jsonl_file.name
    if not jsonl_file.is_file():
        return [f"{file_name}: manifest is missing"]

    try:
        lines = jsonl_file.read_text(encoding="utf-8").splitlines()
    except (OSError, UnicodeError) as exc:
        return [f"{file_name}: manifest cannot be read: {exc}"]

    errors: list[str] = []
    non_empty_rows = 0
    valid_entries = 0
    for line_num, line in enumerate(lines, start=1):
        if not line.strip():
            continue
        non_empty_rows += 1
        try:
            data = json.loads(line)
        except json.JSONDecodeError as exc:
            errors.append(f"{file_name}:{line_num}: invalid JSON: {exc.msg}")
            continue
        if not isinstance(data, dict):
            errors.append(f"{file_name}:{line_num}: entry must be a JSON object")
            continue

        raw_file = data.get("file")
        if raw_file is None and "_example" in data:
            # A seed row is valid guidance, but never counts as dispatch context.
            continue
        if not isinstance(raw_file, str) or not raw_file.strip():
            errors.append(
                f"{file_name}:{line_num}: entry requires a non-empty string field 'file'"
            )
            continue

        file_path = raw_file.strip()
        raw_type = data.get("type", "file")
        if raw_type not in ("file", "directory"):
            errors.append(
                f"{file_name}:{line_num}: type must be 'file' or 'directory'"
            )
            continue
        full_path = _resolve_context_entry_path(file_path, repo_root, task_dir)
        if full_path is None:
            errors.append(
                f"{file_name}:{line_num}: referenced path escapes the task archive: {file_path}"
            )
            continue
        unreadable = _readable_context_entry(
            full_path,
            raw_type,
            repo_root,
            task_dir,
        )
        if unreadable:
            errors.append(
                f"{file_name}:{line_num}: referenced {raw_type} {unreadable}: {file_path}"
            )
            continue
        valid_entries += 1

    if non_empty_rows == 0:
        errors.append(f"{file_name}: manifest is empty")
    if valid_entries == 0:
        errors.append(
            f"{file_name}: manifest has no valid readable 'file' entry (seed rows do not count)"
        )
    return errors


def validate_subagent_context_readiness(
    task_dir: Path,
    repo_root: Path,
    manifest_names: tuple[str, ...] = ("implement.jsonl", "check.jsonl"),
) -> list[str]:
    """Return readiness blockers for the requested task context manifests."""
    errors: list[str] = []
    for manifest_name in manifest_names:
        errors.extend(
            validate_context_manifest_readiness(
                task_dir / manifest_name,
                repo_root,
                task_dir,
            )
        )
    return errors


def cmd_validate_role_context(args: argparse.Namespace) -> int:
    """Fail closed unless one implement/check role manifest is dispatch-ready."""
    repo_root = get_repo_root()
    target_dir = resolve_task_dir(args.dir, repo_root)

    if not target_dir.is_dir():
        print(colored("Error: task directory required", Colors.RED), file=sys.stderr)
        return 1

    manifest_name = f"{args.role}.jsonl"
    errors = validate_subagent_context_readiness(
        target_dir,
        repo_root,
        manifest_names=(manifest_name,),
    )
    if errors:
        print(
            colored(
                f"Role context is not ready for {args.role} dispatch:",
                Colors.RED,
            ),
            file=sys.stderr,
        )
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1

    print(colored(f"Role context ready: {manifest_name}", Colors.GREEN))
    return 0


# =============================================================================
# Command: list-context
# =============================================================================

def cmd_list_context(args: argparse.Namespace) -> int:
    """List JSONL context entries."""
    repo_root = get_repo_root()
    target_dir = resolve_task_dir(args.dir, repo_root)

    if not target_dir.is_dir():
        print(colored("Error: task directory required", Colors.RED))
        return 1

    print(colored("=== Context Files ===", Colors.BLUE))
    print()

    for jsonl_name in ["implement.jsonl", "check.jsonl"]:
        jsonl_file = target_dir / jsonl_name
        if not jsonl_file.is_file():
            continue

        print(colored(f"[{jsonl_name}]", Colors.CYAN))

        count = 0
        seed_only = True
        for line in jsonl_file.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue

            try:
                data = json.loads(line)
            except json.JSONDecodeError:
                continue

            file_path = data.get("file")
            if not file_path:
                # Seed / comment row — don't count as a real entry
                continue
            seed_only = False

            count += 1
            entry_type = data.get("type", "file")
            reason = data.get("reason", "-")

            if entry_type == "directory":
                print(f"  {colored(f'{count}.', Colors.GREEN)} [DIR] {file_path}")
            else:
                print(f"  {colored(f'{count}.', Colors.GREEN)} {file_path}")
            print(f"     {colored('→', Colors.YELLOW)} {reason}")

        if seed_only:
            print(f"  {colored('(no curated entries yet — only seed row)', Colors.YELLOW)}")

        print()

    return 0
