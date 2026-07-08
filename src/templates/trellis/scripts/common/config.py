#!/usr/bin/env python3
"""
Trellis configuration reader.

Reads settings from .trellis/config.yaml with sensible defaults.
"""

from __future__ import annotations

from pathlib import Path

from .paths import DIR_WORKFLOW, get_repo_root
from .worktree import parse_simple_yaml


import sys


# Defaults
DEFAULT_SESSION_COMMIT_MESSAGE = "chore: record journal"
DEFAULT_MAX_JOURNAL_LINES = 2000

CONFIG_FILE = "config.yaml"


def _is_true_config_value(value: object) -> bool:
    """Return True when a config value represents an enabled flag."""
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() == "true"
    return False


def _get_config_path(repo_root: Path | None = None) -> Path:
    """Get path to config.yaml."""
    root = repo_root or get_repo_root()
    return root / DIR_WORKFLOW / CONFIG_FILE


def _load_config(repo_root: Path | None = None) -> dict:
    """Load and parse config.yaml. Returns empty dict on any error."""
    config_file = _get_config_path(repo_root)
    try:
        content = config_file.read_text(encoding="utf-8")
        return parse_simple_yaml(content)
    except (OSError, IOError):
        return {}


def get_session_commit_message(repo_root: Path | None = None) -> str:
    """Get the commit message for auto-committing session records."""
    config = _load_config(repo_root)
    return config.get("session_commit_message", DEFAULT_SESSION_COMMIT_MESSAGE)


def get_max_journal_lines(repo_root: Path | None = None) -> int:
    """Get the maximum lines per journal file."""
    config = _load_config(repo_root)
    value = config.get("max_journal_lines", DEFAULT_MAX_JOURNAL_LINES)
    try:
        return int(value)
    except (ValueError, TypeError):
        return DEFAULT_MAX_JOURNAL_LINES


def get_hooks(event: str, repo_root: Path | None = None) -> list[str]:
    """Get hook commands for a lifecycle event.

    Args:
        event: Event name (e.g. "after_create", "after_archive").
        repo_root: Repository root path.

    Returns:
        List of shell commands to execute, empty if none configured.
    """
    config = _load_config(repo_root)
    hooks = config.get("hooks")
    if not isinstance(hooks, dict):
        return []
    commands = hooks.get(event)
    if isinstance(commands, list):
        return [str(c) for c in commands]
    return []


def get_governance_config(repo_root: Path | None = None) -> dict:
    """Get governance gate configuration.

    The governance section is intentionally generic. Team-specific policy can
    live in external spec repositories or executable adapters, while Trellis
    owns the runtime enforcement points.
    """
    config = _load_config(repo_root)
    governance = config.get("governance")
    if isinstance(governance, dict):
        return governance
    return {}


def is_governance_enabled(repo_root: Path | None = None) -> bool:
    """Return True when governance hard gates are enabled."""
    governance = get_governance_config(repo_root)
    return _is_true_config_value(governance.get("enabled"))


def get_governance_command(repo_root: Path | None = None) -> str | None:
    """Get optional external governance evaluator command."""
    governance = get_governance_config(repo_root)
    command = governance.get("command")
    if isinstance(command, str) and command.strip():
        return command.strip()
    return None


def is_governance_event_enforced(
    event: str,
    repo_root: Path | None = None,
) -> bool:
    """Return True when a governance event should be hard-blocking."""
    if not is_governance_enabled(repo_root):
        return False

    governance = get_governance_config(repo_root)
    enforce = governance.get("enforce")
    if isinstance(enforce, dict):
        value = enforce.get(event)
        if value is not None:
            return _is_true_config_value(value)

    # If governance is enabled, task creation and activation are hard gates by
    # default. Other events are opt-in until they have explicit runtime support.
    return event in {"task_create", "task_start"}


def get_packages(repo_root: Path | None = None) -> dict[str, dict] | None:
    """Get monorepo package declarations."""
    config = _load_config(repo_root)
    packages = config.get("packages")
    if not isinstance(packages, dict):
        return None
    filtered = {k: v for k, v in packages.items() if isinstance(v, dict)}
    if not filtered:
        return None
    return filtered


def get_default_package(repo_root: Path | None = None) -> str | None:
    """Get the default package name from config."""
    config = _load_config(repo_root)
    value = config.get("default_package")
    return str(value) if value else None


def get_submodule_packages(repo_root: Path | None = None) -> dict[str, str]:
    """Get packages that are git submodules."""
    packages = get_packages(repo_root)
    if packages is None:
        return {}
    return {
        name: cfg.get("path", name)
        for name, cfg in packages.items()
        if cfg.get("type") == "submodule"
    }


def get_git_packages(repo_root: Path | None = None) -> dict[str, str]:
    """Get packages that have their own independent git repository."""
    packages = get_packages(repo_root)
    if packages is None:
        return {}
    return {
        name: cfg.get("path", name)
        for name, cfg in packages.items()
        if _is_true_config_value(cfg.get("git"))
    }


def is_monorepo(repo_root: Path | None = None) -> bool:
    """Check if the project is configured as a monorepo."""
    return get_packages(repo_root) is not None


def get_spec_base(package: str | None = None, repo_root: Path | None = None) -> str:
    """Get the spec directory base path relative to .trellis/."""
    if package and is_monorepo(repo_root):
        return f"spec/{package}"
    return "spec"


def validate_package(package: str, repo_root: Path | None = None) -> bool:
    """Check if a package name is valid in this project."""
    packages = get_packages(repo_root)
    if packages is None:
        return True
    return package in packages


def resolve_package(
    task_package: str | None = None,
    repo_root: Path | None = None,
) -> str | None:
    """Resolve package from inferred sources with validation."""
    packages = get_packages(repo_root)
    if packages is None:
        return None

    if task_package and isinstance(task_package, str):
        if task_package in packages:
            return task_package
        print(
            f"Warning: task.json package '{task_package}' not found in config, skipping",
            file=sys.stderr,
        )

    default = get_default_package(repo_root)
    if default:
        if default in packages:
            return default
        print(
            f"Warning: default_package '{default}' not found in config, skipping",
            file=sys.stderr,
        )

    return None


def get_spec_scope(repo_root: Path | None = None) -> list[str] | str | None:
    """Get session.spec_scope configuration."""
    config = _load_config(repo_root)
    session = config.get("session")
    if not isinstance(session, dict):
        return None

    scope = session.get("spec_scope")
    if scope is None:
        return None
    if isinstance(scope, str):
        return scope
    if isinstance(scope, list):
        return [str(s) for s in scope]
    return None
