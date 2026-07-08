#!/usr/bin/env python3
"""
Package discovery and context output.
"""

from __future__ import annotations

import json
from pathlib import Path

from .config import _is_true_config_value, get_default_package, get_packages, get_spec_scope
from .paths import DIR_SPEC, DIR_WORKFLOW, FILE_TASK_JSON, get_current_task, get_repo_root


def _scan_spec_layers(spec_dir: Path, package: str | None = None) -> list[str]:
    target = spec_dir / package if package else spec_dir
    if not target.is_dir():
        return []
    return sorted(
        d.name for d in target.iterdir() if d.is_dir() and d.name != "guides"
    )


def _get_active_task_package(repo_root: Path) -> str | None:
    current = get_current_task(repo_root)
    if not current:
        return None

    task_json = repo_root / current / FILE_TASK_JSON
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
    packages: dict,
    spec_scope,
    task_pkg: str | None,
    default_pkg: str | None,
) -> set | None:
    if not packages:
        return None

    if spec_scope is None:
        return None

    if isinstance(spec_scope, str) and spec_scope == "active_task":
        if task_pkg and task_pkg in packages:
            return {task_pkg}
        if default_pkg and default_pkg in packages:
            return {default_pkg}
        return None

    if isinstance(spec_scope, list):
        valid = {entry for entry in spec_scope if entry in packages}
        if valid:
            return valid
        if task_pkg and task_pkg in packages:
            return {task_pkg}
        if default_pkg and default_pkg in packages:
            return {default_pkg}
        return None

    return None


def get_packages_info(repo_root: Path) -> list[dict]:
    packages = get_packages(repo_root)
    if not packages:
        return []

    default_pkg = get_default_package(repo_root)
    spec_dir = repo_root / DIR_WORKFLOW / DIR_SPEC
    result = []

    for pkg_name, pkg_config in packages.items():
        pkg_path = pkg_config.get("path", pkg_name) if isinstance(pkg_config, dict) else str(pkg_config)
        pkg_type = pkg_config.get("type", "local") if isinstance(pkg_config, dict) else "local"
        pkg_git = pkg_config.get("git", False) if isinstance(pkg_config, dict) else False
        layers = _scan_spec_layers(spec_dir, pkg_name)

        result.append({
            "name": pkg_name,
            "path": pkg_path,
            "type": pkg_type,
            "default": pkg_name == default_pkg,
            "specLayers": layers,
            "isSubmodule": pkg_type == "submodule",
            "isGitRepo": _is_true_config_value(pkg_git),
        })

    return result


def get_packages_section(repo_root: Path) -> str:
    spec_dir = repo_root / DIR_WORKFLOW / DIR_SPEC
    pkg_info = get_packages_info(repo_root)

    lines: list[str] = []
    lines.append("## PACKAGES")

    if not pkg_info:
        lines.append("(single-repo mode)")
        layers = _scan_spec_layers(spec_dir)
        if layers:
            lines.append(f"Spec layers: {', '.join(layers)}")
        return "\n".join(lines)

    default_pkg = get_default_package(repo_root)

    for pkg in pkg_info:
        layers_str = f"  [{', '.join(pkg['specLayers'])}]" if pkg["specLayers"] else ""
        submodule_tag = "  (submodule)" if pkg["isSubmodule"] else ""
        git_repo_tag = "  (git repo)" if pkg["isGitRepo"] else ""
        default_tag = "  *" if pkg["default"] else ""
        lines.append(
            f"- {pkg['name']:<16} {pkg['path']:<20}{layers_str}{submodule_tag}{git_repo_tag}{default_tag}"
        )

    if default_pkg:
        lines.append(f"Default package: {default_pkg}")

    return "\n".join(lines)


def get_context_packages_text(repo_root: Path | None = None) -> str:
    if repo_root is None:
        repo_root = get_repo_root()

    pkg_info = get_packages_info(repo_root)
    lines: list[str] = []

    if not pkg_info:
        spec_dir = repo_root / DIR_WORKFLOW / DIR_SPEC
        lines.append("Single-repo project (no packages configured)")
        lines.append("")
        layers = _scan_spec_layers(spec_dir)
        if layers:
            lines.append(f"Spec layers: {', '.join(layers)}")
        return "\n".join(lines)

    packages_dict = get_packages(repo_root) or {}
    default_pkg = get_default_package(repo_root)
    spec_scope = get_spec_scope(repo_root)
    task_pkg = _get_active_task_package(repo_root)
    scope_set = _resolve_scope_set(packages_dict, spec_scope, task_pkg, default_pkg)

    lines.append("## PACKAGES")
    lines.append("")
    for pkg in pkg_info:
        default_tag = " (default)" if pkg["default"] else ""
        type_tag = f" [{pkg['type']}]" if pkg["type"] != "local" else ""
        git_tag = " [git repo]" if pkg["isGitRepo"] else ""
        scope_tag = ""
        if scope_set is not None and pkg["name"] not in scope_set:
            scope_tag = " (out of scope)"

        lines.append(f"### {pkg['name']}{default_tag}{type_tag}{git_tag}{scope_tag}")
        lines.append(f"Path: {pkg['path']}")
        if pkg["specLayers"]:
            lines.append(f"Spec layers: {', '.join(pkg['specLayers'])}")
            for layer in pkg["specLayers"]:
                lines.append(f"  - .trellis/spec/{pkg['name']}/{layer}/index.md")
        else:
            lines.append("Spec: not configured")
        lines.append("")

    guides_dir = repo_root / DIR_WORKFLOW / DIR_SPEC / "guides"
    if guides_dir.is_dir():
        lines.append("### Shared Guides (always included)")
        lines.append("Path: .trellis/spec/guides/index.md")
        lines.append("")

    return "\n".join(lines)


def get_context_packages_json(repo_root: Path | None = None) -> dict:
    if repo_root is None:
        repo_root = get_repo_root()

    pkg_info = get_packages_info(repo_root)

    if not pkg_info:
        spec_dir = repo_root / DIR_WORKFLOW / DIR_SPEC
        layers = _scan_spec_layers(spec_dir)
        return {
            "mode": "single-repo",
            "specLayers": layers,
        }

    default_pkg = get_default_package(repo_root)
    spec_scope = get_spec_scope(repo_root)
    task_pkg = _get_active_task_package(repo_root)

    return {
        "mode": "monorepo",
        "packages": pkg_info,
        "defaultPackage": default_pkg,
        "specScope": spec_scope,
        "activeTaskPackage": task_pkg,
    }
