#!/usr/bin/env python3

"""Prepare a combined multi-repository review context."""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path
from typing import List, Sequence


def run_git(repo: Path, args: Sequence[str], check: bool = True) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", "-C", str(repo), *args],
        text=True,
        capture_output=True,
        check=check,
    )


def validate_repo(repo: Path) -> None:
    if not repo.exists():
        raise FileNotFoundError(f"Repository does not exist: {repo}")
    result = run_git(repo, ["rev-parse", "--is-inside-work-tree"])
    if result.stdout.strip() != "true":
        raise ValueError(f"Not a git repository: {repo}")


def fetch_repo(repo: Path) -> str:
    result = run_git(repo, ["fetch", "--all", "--prune", "--tags"], check=False)
    if result.returncode == 0:
        return "ok"
    detail = result.stderr.strip() or result.stdout.strip() or f"exit={result.returncode}"
    return f"failed: {detail}"


def resolve_ref(repo: Path, ref: str) -> str:
    candidates = [ref]
    if "/" not in ref:
        candidates.extend([f"origin/{ref}", f"upstream/{ref}"])
    for candidate in candidates:
        result = run_git(repo, ["rev-parse", "--verify", candidate], check=False)
        if result.returncode == 0:
            return candidate
    raise ValueError(f"Unable to resolve ref '{ref}' in {repo}")


def git_output(repo: Path, args: Sequence[str]) -> str:
    result = run_git(repo, args, check=False)
    if result.returncode != 0:
        return f"[command failed] git -C {repo} {' '.join(args)}\n{result.stderr.strip()}"
    return result.stdout.strip()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", action="append", default=[], help="Repository path. Repeat for multiple repositories.")
    parser.add_argument("--from", dest="from_branches", action="append", default=[], help="Source branch for the corresponding repo.")
    parser.add_argument("--to", dest="to_branches", action="append", default=[], help="Target branch for the corresponding repo.")
    parser.add_argument("--intent", action="append", default=[], help="Intent or design document path.")
    parser.add_argument("--skip-fetch", action="store_true", help="Skip git fetch and only inspect local refs.")
    return parser.parse_args()


def ensure_equal_lengths(values: argparse.Namespace) -> None:
    repo_count = len(values.repo)
    if repo_count == 0:
        raise ValueError("At least one --repo is required.")
    if repo_count != len(values.from_branches) or repo_count != len(values.to_branches):
        raise ValueError("The number of --repo, --from, and --to arguments must match.")


def render_repo_section(index: int, repo: Path, source_ref: str, target_ref: str, fetch_status: str) -> str:
    source_sha = git_output(repo, ["rev-parse", source_ref])
    target_sha = git_output(repo, ["rev-parse", target_ref])
    merge_base = git_output(repo, ["merge-base", target_ref, source_ref])
    commits = git_output(repo, ["log", "--oneline", f"{target_ref}..{source_ref}"])
    diffstat = git_output(repo, ["diff", "--stat", f"{target_ref}..{source_ref}"])
    changed_files = git_output(repo, ["diff", "--name-status", f"{target_ref}..{source_ref}"])

    lines: List[str] = [
        f"## Repo {index}: {repo}",
        "",
        f"- Fetch: {fetch_status}",
        f"- Review Range: `{target_ref}..{source_ref}`",
        f"- Target SHA: `{target_sha}`",
        f"- Source SHA: `{source_sha}`",
        f"- Merge Base: `{merge_base}`",
        "",
        "### Commits",
        "```text",
        commits or "(no commits in range)",
        "```",
        "",
        "### Diffstat",
        "```text",
        diffstat or "(no diffstat available)",
        "```",
        "",
        "### Changed Files",
        "```text",
        changed_files or "(no changed files)",
        "```",
        "",
    ]
    return "\n".join(lines)


def render_intent_section(intent_paths: Sequence[str]) -> str:
    lines = ["# Intent Documents", ""]
    if not intent_paths:
        lines.append("No intent or design documents were provided.")
        lines.append("")
        return "\n".join(lines)

    for raw_path in intent_paths:
        path = Path(os.path.expanduser(raw_path)).resolve()
        if path.exists():
            lines.append(f"- {path}")
        else:
            lines.append(f"- {path} (missing)")
    lines.append("")
    return "\n".join(lines)


def main() -> int:
    args = parse_args()
    try:
        ensure_equal_lengths(args)
        sections: List[str] = [
            "# Combined PR Review Context",
            "",
            render_intent_section(args.intent),
            "# Repository Review Context",
            "",
        ]

        for index, (repo_arg, from_branch, to_branch) in enumerate(
            zip(args.repo, args.from_branches, args.to_branches),
            start=1,
        ):
            repo = Path(os.path.expanduser(repo_arg)).resolve()
            validate_repo(repo)
            fetch_status = "skipped"
            if not args.skip_fetch:
                fetch_status = fetch_repo(repo)
            source_ref = resolve_ref(repo, from_branch)
            target_ref = resolve_ref(repo, to_branch)
            sections.append(render_repo_section(index, repo, source_ref, target_ref, fetch_status))

        sys.stdout.write("\n".join(sections))
        return 0
    except Exception as exc:  # pragma: no cover - used for CLI reporting
        print(f"error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
