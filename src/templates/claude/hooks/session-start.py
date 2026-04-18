#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Session Start Hook - Inject structured context
"""

# IMPORTANT: Suppress all warnings FIRST
import warnings
warnings.filterwarnings("ignore")

import json
import os
import subprocess
import sys
from io import StringIO
from pathlib import Path

MAX_SPEC_FILES = 40
MAX_SPEC_CHARS = 24_000
DEFAULT_SPEC_DIRS = ("frontend", "backend", "guides")

# IMPORTANT: Force stdout to use UTF-8 on Windows
# This fixes UnicodeEncodeError when outputting non-ASCII characters
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


def run_script(script_path: Path) -> str:
    try:
        if script_path.suffix == ".py":
            # Add PYTHONIOENCODING to force UTF-8 in subprocess
            env = os.environ.copy()
            env["PYTHONIOENCODING"] = "utf-8"
            cmd = [sys.executable, "-W", "ignore", str(script_path)]
        else:
            env = os.environ
            cmd = [str(script_path)]

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
        return result.stdout if result.returncode == 0 else "No context available"
    except (subprocess.TimeoutExpired, FileNotFoundError, PermissionError):
        return "No context available"


def format_section_name(name: str) -> str:
    if name == "__root__":
        return "Specs"
    return " ".join(
        part.capitalize() for part in name.replace("-", " ").replace("_", " ").split()
    )


def has_index_file(directory: Path) -> bool:
    return (directory / "index.md").is_file()


def section_dir_sort_key(section_dir: Path) -> tuple[int, int, str]:
    has_index = has_index_file(section_dir)
    is_default = section_dir.name in DEFAULT_SPEC_DIRS

    if has_index and not is_default:
        return (0, 0, section_dir.name)
    if is_default:
        return (1, DEFAULT_SPEC_DIRS.index(section_dir.name), section_dir.name)
    if has_index:
        return (2, 0, section_dir.name)
    return (3, 0, section_dir.name)


def iter_markdown_files(directory: Path):
    try:
        entries = [entry for entry in directory.iterdir() if not entry.name.startswith(".")]
    except (FileNotFoundError, PermissionError):
        return

    index_file = next(
        (
            entry
            for entry in entries
            if entry.is_file() and entry.suffix == ".md" and entry.name == "index.md"
        ),
        None,
    )
    if index_file is not None:
        yield index_file

    other_files = sorted(
        (
            entry
            for entry in entries
            if entry.is_file() and entry.suffix == ".md" and entry.name != "index.md"
        ),
        key=lambda path: path.name,
    )
    for spec_file in other_files:
        yield spec_file

    child_dirs = sorted(
        (entry for entry in entries if entry.is_dir()),
        key=lambda path: path.name,
    )
    for child_dir in child_dirs:
        yield from iter_markdown_files(child_dir)


def iter_spec_sections(spec_root: Path):
    try:
        entries = [entry for entry in spec_root.iterdir() if not entry.name.startswith(".")]
    except (FileNotFoundError, PermissionError):
        return

    root_files = sorted(
        (entry for entry in entries if entry.is_file() and entry.suffix == ".md"),
        key=lambda path: (path.name != "index.md", path.name),
    )
    if root_files:
        yield (format_section_name("__root__"), root_files)

    section_dirs = sorted(
        (entry for entry in entries if entry.is_dir()),
        key=section_dir_sort_key,
    )
    for section_dir in section_dirs:
        files = list(iter_markdown_files(section_dir))
        if files:
            yield (format_section_name(section_dir.name), files)


def write_spec_context(output: StringIO, spec_root: Path) -> None:
    files_written = 0
    chars_written = 0
    has_content = False
    truncated = False

    for section_name, section_files in iter_spec_sections(spec_root) or []:
        section_started = False

        for spec_file in section_files:
            content = read_file(spec_file)
            if not content:
                continue

            relative_path = spec_file.relative_to(spec_root).as_posix()
            entry_parts = []
            if not section_started:
                entry_parts.append(f"## {section_name}")
            entry_parts.append(f"### {relative_path}")
            entry_parts.append(content)
            entry_text = "\n\n".join(entry_parts)

            if files_written >= MAX_SPEC_FILES or chars_written + len(entry_text) > MAX_SPEC_CHARS:
                truncated = True
                break

            if has_content:
                output.write("\n\n")
            output.write(entry_text)

            has_content = True
            section_started = True
            files_written += 1
            chars_written += len(entry_text)

        if truncated:
            break

    if not has_content:
        output.write("Not configured")
    elif truncated:
        output.write(
            f"\n\n[Spec context truncated after {files_written} files / {chars_written} chars. Read additional spec files on demand.]"
        )


def main():
    if should_skip_injection():
        sys.exit(0)

    project_dir = Path(os.environ.get("CLAUDE_PROJECT_DIR", ".")).resolve()
    trellis_dir = project_dir / ".trellis"
    claude_dir = project_dir / ".claude"

    output = StringIO()

    output.write("""<session-context>
You are starting a new session in a Trellis-managed project.
Read and follow all instructions below carefully.
</session-context>

""")

    output.write("<current-state>\n")
    context_script = trellis_dir / "scripts" / "get_context.py"
    output.write(run_script(context_script))
    output.write("\n</current-state>\n\n")

    output.write("<workflow>\n")
    workflow_content = read_file(trellis_dir / "workflow.md", "No workflow.md found")
    output.write(workflow_content)
    output.write("\n</workflow>\n\n")

    output.write("<guidelines>\n")
    write_spec_context(output, trellis_dir / "spec")
    output.write("\n</guidelines>\n\n")

    output.write("<instructions>\n")
    start_md = read_file(
        claude_dir / "commands" / "trellis" / "start.md", "No start.md found"
    )
    output.write(start_md)
    output.write("\n</instructions>\n\n")

    output.write("""<ready>
Context loaded. Wait for user's first message, then follow <instructions> to handle their request.
</ready>""")

    result = {
        "hookSpecificOutput": {
            "hookEventName": "SessionStart",
            "additionalContext": output.getvalue(),
        }
    }

    # Output JSON - stdout is already configured for UTF-8
    print(json.dumps(result, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
