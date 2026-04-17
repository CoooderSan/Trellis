#!/usr/bin/env python3

"""Prepare a structured Codeup PR comment context."""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any

CURRENT_DIR = Path(__file__).resolve().parent
SHARED_DIR = CURRENT_DIR.parent.parent / "shared"
if str(SHARED_DIR) not in sys.path:
    sys.path.insert(0, str(SHARED_DIR))

from codeup_client import CodeupApiError, CodeupClient, CodeupRequestContext, describe_auth_mode
from codeup_config import detect_codeup_repo_from_git, parse_change_request_url, resolve_codeup_config
from codeup_normalizers import normalize_comment_payload


MUST_FIX_PATTERNS = [
    r"\bbug\b",
    r"\bmust\b",
    r"\bshould fix\b",
    r"\bneed(s|ed)?\b",
    r"\bregression\b",
    r"\berror\b",
    r"\bfail(ed|ure)?\b",
    r"缺少测试",
    r"必须",
    r"会出错",
    r"会回归",
]

NEEDS_CONFIRMATION_PATTERNS = [
    r"\bmaybe\b",
    r"\bconsider\b",
    r"\bquestion\b",
    r"\bnot sure\b",
    r"是否",
    r"要不要",
    r"确认一下",
    r"需要确认",
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pr-url", default="", help="PR URL if available.")
    parser.add_argument("--mr-url", default="", help="MR URL if available.")
    parser.add_argument("--repo", default="", help="Repository path or repository name.")
    parser.add_argument("--pr-number", default="", help="PR number if available.")
    parser.add_argument("--mr-iid", default="", help="Merge request local ID.")
    parser.add_argument("--project-id", default="", help="Repository/project ID override.")
    parser.add_argument("--organization-id", default="", help="Codeup organization ID override.")
    parser.add_argument("--base-url", default="", help="Codeup API base URL override.")
    parser.add_argument("--auth-mode", default="", help="Auth mode override.")
    parser.add_argument("--access-token", default="", help="Access token override.")
    parser.add_argument("--cookie", default="", help="Cookie override.")
    parser.add_argument("--use-api", action="store_true", help="Prefer fetching comments from Codeup API.")
    parser.add_argument("--unresolved-only", action="store_true", help="Only fetch unresolved comments from API.")
    parser.add_argument("--from", dest="source_branch", default="", help="Source branch.")
    parser.add_argument("--to", dest="target_branch", default="", help="Target branch.")
    parser.add_argument("--intent", action="append", default=[], help="Intent or design document path.")
    parser.add_argument("--comments-file", default="", help="Path to a JSON or text comment export.")
    parser.add_argument("--comment", action="append", default=[], help="Inline comment text. Repeat for multiple comments.")
    return parser.parse_args()


def detect_classification(text: str) -> str:
    lowered = text.lower()
    for pattern in MUST_FIX_PATTERNS:
        if re.search(pattern, lowered, flags=re.IGNORECASE):
            return "Must Fix"
    for pattern in NEEDS_CONFIRMATION_PATTERNS:
        if re.search(pattern, lowered, flags=re.IGNORECASE):
            return "Needs Confirmation"
    return "Suggestion / Informational"


def normalize_comment(item: Any) -> dict[str, str]:
    if isinstance(item, str):
        return {
            "body": item.strip(),
            "file": "(unknown file)",
            "line": "",
            "author": "",
        }

    if not isinstance(item, dict):
        return {
            "body": str(item).strip(),
            "file": "(unknown file)",
            "line": "",
            "author": "",
        }

    body = (
        item.get("body")
        or item.get("comment")
        or item.get("content")
        or item.get("text")
        or ""
    )
    file_path = (
        item.get("file")
        or item.get("path")
        or item.get("filePath")
        or "(unknown file)"
    )
    line = item.get("line") or item.get("lineNumber") or item.get("position") or ""
    author = item.get("author") or item.get("user") or item.get("creator") or ""

    return {
        "body": str(body).strip(),
        "file": str(file_path).strip() or "(unknown file)",
        "line": str(line).strip(),
        "author": str(author).strip(),
    }


def load_comments_from_json(payload: Any) -> list[dict[str, str]]:
    if isinstance(payload, list):
        return [normalize_comment(item) for item in payload]

    if isinstance(payload, dict):
        for key in ("comments", "data", "items", "records"):
            value = payload.get(key)
            if isinstance(value, list):
                return [normalize_comment(item) for item in value]
        return [normalize_comment(payload)]

    raise ValueError("Unsupported JSON comment format")


def load_comments_from_file(file_path: str) -> list[dict[str, str]]:
    path = Path(os.path.expanduser(file_path)).resolve()
    if not path.exists():
        raise FileNotFoundError(f"Comments file does not exist: {path}")

    raw = path.read_text(encoding="utf-8").strip()
    if not raw:
        return []

    if path.suffix.lower() == ".json":
        return load_comments_from_json(json.loads(raw))

    blocks = [block.strip() for block in re.split(r"\n\s*\n", raw) if block.strip()]
    return [normalize_comment(block) for block in blocks]


def _should_use_api(args: argparse.Namespace) -> bool:
    return bool(args.use_api or args.mr_url or args.pr_url or args.mr_iid or args.pr_number)


def _resolve_request_context(args: argparse.Namespace) -> tuple[CodeupRequestContext, str, Any, Any]:
    repo_info = detect_codeup_repo_from_git(args.repo) if args.repo else None
    mr_ref = parse_change_request_url(args.mr_url or args.pr_url)

    organization_id = args.organization_id or (mr_ref.organization_id if mr_ref else "") or (repo_info.organization_id if repo_info else "")
    repository_id = args.project_id or (mr_ref.repository_path if mr_ref else "") or (repo_info.repository_path if repo_info else "")
    if organization_id and repository_id and not repository_id.startswith(f"{organization_id}/") and not str(repository_id).isdigit():
        repository_id = f"{organization_id}/{repository_id}"
    local_id = args.mr_iid or args.pr_number or (mr_ref.local_id if mr_ref else "")

    if not repository_id:
        raise ValueError("Repository/project identifier is required for Codeup API mode. Use --project-id or provide --repo with a Codeup remote.")
    if not local_id:
        raise ValueError("MR local ID is required for Codeup API mode. Use --mr-iid / --pr-number / --mr-url.")

    source = "mr-url" if mr_ref else "repo-config"
    return CodeupRequestContext(organization_id=organization_id, repository_id=repository_id, local_id=local_id), source, repo_info, mr_ref


def fetch_comments_from_api(args: argparse.Namespace) -> tuple[list[dict[str, str]], dict[str, str]]:
    ctx, source, repo_info, mr_ref = _resolve_request_context(args)
    config = resolve_codeup_config(
        {
            "base_url": args.base_url,
            "auth_mode": args.auth_mode,
            "access_token": args.access_token,
            "cookie": args.cookie,
            "organization_id": ctx.organization_id,
            "repository_path": ctx.repository_id,
            "project_id": args.project_id,
        }
    )
    if not config.has_auth:
        raise ValueError(
            "Codeup API mode requires authentication. Configure governance.codeupAccessToken or pass --access-token. Use --cookie only if your tenant requires cookie auth."
        )

    client = CodeupClient(config)
    payload = client.list_change_request_comments(
        CodeupRequestContext(
            organization_id=ctx.organization_id or config.organization_id,
            repository_id=ctx.repository_id,
            local_id=ctx.local_id,
        ),
        unresolved_only=args.unresolved_only,
    )
    comments = normalize_comment_payload(payload)
    metadata = {
        "api_mode": "true",
        "api_source": source,
        "api_auth_mode": describe_auth_mode(config),
        "organization_id": ctx.organization_id or config.organization_id,
        "repository_id": ctx.repository_id,
        "local_id": ctx.local_id,
    }
    return comments, metadata


def collect_comments(args: argparse.Namespace) -> tuple[list[dict[str, str]], dict[str, str]]:
    comments: list[dict[str, str]] = []
    metadata: dict[str, str] = {}
    fallback_available = bool(args.comments_file or args.comment)

    if _should_use_api(args):
        try:
            comments, metadata = fetch_comments_from_api(args)
            if comments:
                return comments, metadata
            if fallback_available:
                metadata["warning"] = "Codeup API returned no comments. Falling back to file or inline comments."
        except (CodeupApiError, Exception) as exc:
            if not fallback_available:
                raise
            metadata["warning"] = f"Codeup API unavailable: {exc}. Falling back to file or inline comments."

    if args.comments_file:
        comments.extend(load_comments_from_file(args.comments_file))
        metadata.setdefault("comment_source", f"file:{args.comments_file}")
    comments.extend(normalize_comment(item) for item in args.comment)
    if args.comment and "comment_source" not in metadata:
        metadata["comment_source"] = "inline"
    return [comment for comment in comments if comment["body"]], metadata


def render_metadata(args: argparse.Namespace, comments: list[dict[str, str]], metadata: dict[str, str]) -> str:
    lines = ["# Codeup PR Comment Context", ""]
    if args.pr_url:
        lines.append(f"- PR URL: {args.pr_url}")
    if args.mr_url:
        lines.append(f"- MR URL: {args.mr_url}")
    if args.repo:
        lines.append(f"- Repository: {args.repo}")
    if args.pr_number:
        lines.append(f"- PR Number: {args.pr_number}")
    if args.mr_iid:
        lines.append(f"- MR IID: {args.mr_iid}")
    if args.source_branch or args.target_branch:
        lines.append(f"- Branches: `{args.target_branch or '?'}..{args.source_branch or '?'}`")
    if metadata.get("api_mode") == "true":
        lines.append(f"- Comment Source: Codeup API ({metadata.get('api_auth_mode', 'configured')})")
        if metadata.get("organization_id"):
            lines.append(f"- Organization ID: {metadata['organization_id']}")
        if metadata.get("repository_id"):
            lines.append(f"- Repository ID: {metadata['repository_id']}")
        if metadata.get("local_id"):
            lines.append(f"- Change Request ID: {metadata['local_id']}")
    elif args.comments_file:
        lines.append(f"- Comment Source: file `{args.comments_file}`")
    else:
        lines.append("- Comment Source: inline comments")
    if metadata.get("warning"):
        lines.append(f"- Note: {metadata['warning']}")
    lines.append(f"- Total Comments: {len(comments)}")
    if args.intent:
        lines.append("- Intent Docs:")
        for item in args.intent:
            path = Path(os.path.expanduser(item)).resolve()
            suffix = "" if path.exists() else " (missing)"
            lines.append(f"  - {path}{suffix}")
    lines.append("")
    return "\n".join(lines)


def render_summary(comments: list[dict[str, str]]) -> str:
    buckets: dict[str, list[dict[str, str]]] = defaultdict(list)
    by_file: dict[str, list[dict[str, str]]] = defaultdict(list)

    for comment in comments:
        classification = detect_classification(comment["body"])
        enriched = dict(comment)
        enriched["classification"] = classification
        buckets[classification].append(enriched)
        by_file[comment["file"]].append(enriched)

    lines = ["## Summary by File", ""]
    for file_path in sorted(by_file):
        items = by_file[file_path]
        must_fix = sum(1 for item in items if item["classification"] == "Must Fix")
        confirm = sum(1 for item in items if item["classification"] == "Needs Confirmation")
        suggest = sum(1 for item in items if item["classification"] == "Suggestion / Informational")
        lines.append(f"- {file_path}: {len(items)} comment(s) | Must Fix {must_fix} | Needs Confirmation {confirm} | Suggestion {suggest}")
    lines.append("")

    for section in ("Must Fix", "Needs Confirmation", "Suggestion / Informational"):
        lines.append(f"## {section}")
        lines.append("")
        items = buckets.get(section, [])
        if not items:
            lines.append("- (none)")
            lines.append("")
            continue
        for item in items:
            location = item["file"]
            if item["line"]:
                location = f"{location}:{item['line']}"
            author = f" [{item['author']}]" if item["author"] else ""
            lines.append(f"- {location}{author} — {item['body']}")
        lines.append("")

    lines.extend([
        "## Recommended Next Step",
        "",
        "- Feed the `Must Fix` and `Needs Confirmation` sections into `$codeup-pr-revise` or a natural-language revise request.",
        "- Do not reply to each comment individually unless the user explicitly asks for that workflow.",
        "",
    ])
    return "\n".join(lines)


def main() -> int:
    args = parse_args()
    try:
        comments, metadata = collect_comments(args)
        if not comments:
            raise ValueError("No comments were provided. Use Codeup API mode, --comments-file, or --comment.")
        sys.stdout.write(render_metadata(args, comments, metadata))
        sys.stdout.write(render_summary(comments))
        return 0
    except (CodeupApiError, Exception) as exc:  # pragma: no cover - CLI reporting path
        print(f"error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
