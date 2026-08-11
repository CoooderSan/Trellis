#!/usr/bin/env python3
"""Capture a stable, read-only ITERATION identity for the current Git worktree.

Usage:
    python3 ./.trellis/scripts/capture_iteration_identity.py
"""

from __future__ import annotations

import hashlib
import json
import os
import stat
import subprocess
import sys
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path


class CaptureError(RuntimeError):
    """Raised when a complete, stable worktree identity cannot be captured."""


@dataclass(frozen=True)
class UntrackedIdentity:
    """Content identity for one untracked, non-ignored filesystem entry."""

    path: str
    sha256: str
    kind: str


@dataclass(frozen=True)
class Snapshot:
    """Git and filesystem values that must remain stable during capture."""

    head: str
    staged_diff_sha256: str
    unstaged_diff_sha256: str
    untracked: tuple[UntrackedIdentity, ...]


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _sha256(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def _run_git(args: list[str], *, cwd: Path) -> bytes:
    try:
        result = subprocess.run(
            ["git", "-c", "i18n.logOutputEncoding=UTF-8", *args],
            cwd=cwd,
            capture_output=True,
            check=False,
        )
    except OSError as error:
        raise CaptureError(f"unable to execute git: {error}") from error

    if result.returncode != 0:
        detail = result.stderr.decode("utf-8", errors="replace").strip()
        command = "git " + " ".join(args)
        raise CaptureError(f"{command} failed: {detail or 'unknown error'}")
    return result.stdout


def _repository_root(cwd: Path) -> Path:
    raw = _run_git(["rev-parse", "--show-toplevel"], cwd=cwd)
    value = raw.decode("utf-8", errors="surrogateescape").rstrip("\r\n")
    if not value:
        raise CaptureError("git rev-parse returned an empty repository root")
    return Path(value).resolve()


def _untracked_paths(repo_root: Path) -> tuple[str, ...]:
    raw = _run_git(
        ["ls-files", "--others", "--exclude-standard", "-z"],
        cwd=repo_root,
    )
    encoded_paths = tuple(value for value in raw.split(b"\0") if value)
    return tuple(os.fsdecode(value) for value in encoded_paths)


def _untracked_identity(repo_root: Path, relative_path: str) -> UntrackedIdentity:
    path = repo_root / relative_path
    try:
        mode = path.lstat().st_mode
        if stat.S_ISLNK(mode):
            target = os.readlink(path)
            content = os.fsencode(target)
            kind = "symlink"
        elif stat.S_ISREG(mode):
            content = path.read_bytes()
            kind = "file"
        else:
            raise CaptureError(
                f"unsupported untracked entry type: {relative_path}"
            )
    except OSError as error:
        raise CaptureError(
            f"unable to read untracked entry {relative_path}: {error}"
        ) from error

    return UntrackedIdentity(
        path=relative_path,
        sha256=_sha256(content),
        kind=kind,
    )


def _capture_once(repo_root: Path) -> Snapshot:
    head = (
        _run_git(["rev-parse", "HEAD"], cwd=repo_root)
        .decode("ascii", errors="strict")
        .strip()
    )
    staged_diff = _run_git(
        [
            "diff",
            "--cached",
            "--no-ext-diff",
            "--no-textconv",
            "--binary",
            "--full-index",
            "HEAD",
        ],
        cwd=repo_root,
    )
    unstaged_diff = _run_git(
        [
            "diff",
            "--no-ext-diff",
            "--no-textconv",
            "--binary",
            "--full-index",
        ],
        cwd=repo_root,
    )
    untracked = tuple(
        _untracked_identity(repo_root, relative_path)
        for relative_path in _untracked_paths(repo_root)
    )
    return Snapshot(
        head=head,
        staged_diff_sha256=_sha256(staged_diff),
        unstaged_diff_sha256=_sha256(unstaged_diff),
        untracked=untracked,
    )


def capture_identity(cwd: Path) -> dict[str, object]:
    """Return a stable ITERATION identity or raise CaptureError."""

    repo_root = _repository_root(cwd)
    first = _capture_once(repo_root)
    second = _capture_once(repo_root)
    if first != second:
        raise CaptureError("worktree changed while identity was being captured")

    return {
        "profile": "ITERATION",
        "identity_status": "PASSED",
        "repository_root": str(repo_root),
        "head": second.head,
        "captured_at": _utc_now(),
        "staged_diff_sha256": second.staged_diff_sha256,
        "unstaged_diff_sha256": second.unstaged_diff_sha256,
        "untracked": [asdict(entry) for entry in second.untracked],
    }


def main() -> int:
    try:
        result = capture_identity(Path.cwd())
    except (CaptureError, UnicodeError) as error:
        result = {
            "profile": "ITERATION",
            "identity_status": "UNKNOWN",
            "captured_at": _utc_now(),
            "error": str(error),
        }
        json.dump(result, sys.stdout, ensure_ascii=True, sort_keys=True)
        sys.stdout.write("\n")
        return 2

    json.dump(result, sys.stdout, ensure_ascii=True, sort_keys=True)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
