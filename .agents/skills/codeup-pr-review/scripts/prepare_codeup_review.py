#!/usr/bin/env python3

"""Prepare a structured Codeup PR review context for reviewer-side review."""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any

CURRENT_DIR = Path(__file__).resolve().parent
SHARED_DIR = CURRENT_DIR.parent.parent / "shared"
if str(SHARED_DIR) not in sys.path:
    sys.path.insert(0, str(SHARED_DIR))

from codeup_client import CodeupApiError, CodeupClient, CodeupRequestContext, describe_auth_mode
from codeup_config import detect_codeup_repo_from_git, parse_change_request_url, resolve_codeup_config
from codeup_normalizers import normalize_comment_threads


COMMENT_BODY_KEYS = ("body", "content", "comment", "text")
COMMENT_FILE_KEYS = ("filePath", "file_path", "path")
COMMENT_LINE_KEYS = ("line", "line_number")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", default=".", help="Repository path or repository name.")
    parser.add_argument("--pr-url", default="", help="PR URL if available.")
    parser.add_argument("--mr-url", default="", help="MR URL if available.")
    parser.add_argument("--pr-number", default="", help="PR number if available.")
    parser.add_argument("--mr-iid", default="", help="Merge request local ID.")
    parser.add_argument("--doc", action="append", default=[], help="Intent / design / PRD document path.")
    parser.add_argument("--intent", dest="doc", action="append", help="Alias of --doc.")
    parser.add_argument("--project-id", default="", help="Repository/project ID override.")
    parser.add_argument("--organization-id", default="", help="Codeup organization ID override.")
    parser.add_argument("--base-url", default="", help="Codeup API base URL override.")
    parser.add_argument("--auth-mode", default="", help="Auth mode override.")
    parser.add_argument("--access-token", default="", help="Access token override.")
    parser.add_argument("--cookie", default="", help="Cookie override.")
    parser.add_argument("--existing-comments", action="store_true", help="Also fetch existing comments for reviewer context.")
    parser.add_argument("--post-comments", action="store_true", help="Post draft comments to Codeup (disabled by default unless enabled in config).")
    parser.add_argument("--comment", action="append", default=[], help="Draft comment text to post. Repeat for multiple comments.")
    parser.add_argument("--comment-file", default="", help="JSON file containing comment payload list for post mode.")
    parser.add_argument("--reply-parent-biz-id", default="", help="Parent comment biz ID for reply mode.")
    parser.add_argument("--reply-related-biz-id", default="", help="Related biz ID for reply mode. Required when --reply-parent-biz-id is set.")
    return parser.parse_args()


def first_non_empty(*values: Any) -> str:
    for value in values:
        if value is None:
            continue
        text = str(value).strip()
        if text:
            return text
    return ""


def resolve_request_context(args: argparse.Namespace) -> tuple[CodeupRequestContext, str, Any, Any]:
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


def load_comment_payloads(args: argparse.Namespace) -> list[dict[str, Any]]:
    payloads: list[dict[str, Any]] = []
    for text in args.comment:
        body = str(text).strip()
        if body:
            payloads.append({"content": body})

    if args.comment_file:
        path = Path(os.path.expanduser(args.comment_file)).resolve()
        if not path.exists():
            raise FileNotFoundError(f"Comment file does not exist: {path}")

        raw = path.read_text(encoding="utf-8").strip()
        if not raw:
            return payloads
        data = json.loads(raw)
        if not isinstance(data, list):
            raise ValueError("--comment-file must contain a JSON list of comment payload objects.")
        for item in data:
            if not isinstance(item, dict):
                raise ValueError("Each item in --comment-file must be a JSON object.")
            payloads.append(item)
    return payloads


def _pick_thread_field(item: dict[str, Any], keys: tuple[str, ...]) -> str:
    for key in keys:
        value = item.get(key)
        if value is None:
            continue
        text = str(value).strip()
        if text:
            return text
    return ""


def _build_comment_payload_from_thread(thread: dict[str, Any]) -> dict[str, Any]:
    root = dict(thread)
    content = _pick_thread_field(root, COMMENT_BODY_KEYS)
    if not content:
        raise ValueError("Thread comment content is empty and cannot be posted.")
    file_path = _pick_thread_field(root, COMMENT_FILE_KEYS)
    line = _pick_thread_field(root, COMMENT_LINE_KEYS)
    if not file_path or not line:
        raise ValueError(
            "Reviewer comments must default to line-level comments. Existing thread metadata is missing file_path or line_number, so this script will not downgrade to a general comment automatically."
        )
    return {
        "content": content,
        "file_path": file_path,
        "line_number": line,
    }


def _require_line_level_payload(payload: dict[str, Any], *, allow_reply_without_location: bool) -> None:
    if allow_reply_without_location:
        return
    file_path = _pick_thread_field(payload, ("file_path", "filePath", "path"))
    line = _pick_thread_field(payload, ("line_number", "line", "lineNumber"))
    if not file_path or not line:
        raise ValueError(
            "Reviewer comments must default to line-level comments. Provide file_path and line_number in --comment-file, or use --existing-comments / reply-to-thread mode."
        )


def post_review_comments(args: argparse.Namespace, client: CodeupClient, request_ctx: CodeupRequestContext) -> list[dict[str, Any]]:
    payloads = load_comment_payloads(args)
    if not payloads:
        if not args.existing_comments:
            raise ValueError("--post-comments requires --comment/--comment-file, or use --existing-comments to post thread roots.")
        thread_payload = client.list_change_request_comments(request_ctx, unresolved_only=False)
        threads = normalize_comment_threads(thread_payload)
        payloads = [_build_comment_payload_from_thread(thread) for thread in threads if thread.get("messages")]

    parent_comment_biz_id = args.reply_parent_biz_id.strip()
    related_biz_id = args.reply_related_biz_id.strip()
    posted: list[dict[str, Any]] = []
    for payload in payloads:
        _require_line_level_payload(payload, allow_reply_without_location=bool(parent_comment_biz_id))
        response = client.create_change_request_comment(
            request_ctx,
            payload,
            parent_comment_biz_id=parent_comment_biz_id,
            related_biz_id=related_biz_id,
        )
        posted.append({"payload": payload, "response": response})
    return posted


def summarize_change_request(payload: Any) -> dict[str, str]:
    if not isinstance(payload, dict):
        return {
            "title": "",
            "description": "",
            "source_branch": "",
            "target_branch": "",
            "author": "",
            "state": "",
            "web_url": "",
        }

    author = payload.get("author") if isinstance(payload.get("author"), dict) else {}
    return {
        "title": first_non_empty(payload.get("title"), payload.get("subject")),
        "description": first_non_empty(payload.get("description"), payload.get("body")),
        "source_branch": first_non_empty(payload.get("sourceBranch"), payload.get("source_branch"), payload.get("fromBranch")),
        "target_branch": first_non_empty(payload.get("targetBranch"), payload.get("target_branch"), payload.get("target_branch_name")),
        "author": first_non_empty(author.get("name"), author.get("username"), payload.get("authorName")),
        "state": first_non_empty(payload.get("state"), payload.get("status")),
        "web_url": first_non_empty(payload.get("webUrl"), payload.get("url"), payload.get("web_url")),
    }


def render_header(args: argparse.Namespace, metadata: dict[str, str], change_request: dict[str, str], comment_count: int) -> list[str]:
    lines = ["# Codeup PR Review Context", ""]
    lines.append(f"- Repository: {args.repo}")
    if args.pr_url:
        lines.append(f"- PR URL: {args.pr_url}")
    if args.mr_url:
        lines.append(f"- MR URL: {args.mr_url}")
    lines.append(f"- Comment Source: Codeup API ({metadata.get('api_auth_mode', 'configured')})")
    if metadata.get("organization_id"):
        lines.append(f"- Organization ID: {metadata['organization_id']}")
    if metadata.get("repository_id"):
        lines.append(f"- Repository ID: {metadata['repository_id']}")
    if metadata.get("local_id"):
        lines.append(f"- Change Request ID: {metadata['local_id']}")
    lines.append(f"- Existing Comment Count: {comment_count}")
    if args.doc:
        lines.append("- Reference Docs:")
        for item in args.doc:
            path = Path(os.path.expanduser(item)).resolve()
            suffix = "" if path.exists() else " (missing)"
            lines.append(f"  - {path}{suffix}")
    lines.append("")

    lines.extend([
        "## Change Request Summary",
        "",
        f"- Title: {change_request['title'] or '(unknown)'}",
        f"- Author: {change_request['author'] or '(unknown)'}",
        f"- Branches: `{change_request['target_branch'] or '?'}..{change_request['source_branch'] or '?'}'".replace("'", ""),
        f"- State: {change_request['state'] or '(unknown)'}",
    ])
    if change_request["web_url"]:
        lines.append(f"- Web URL: {change_request['web_url']}")
    lines.append("")
    if change_request["description"]:
        lines.extend([
            "### Description",
            "```text",
            change_request["description"],
            "```",
            "",
        ])
    return lines


def render_existing_comments(threads: list[dict[str, Any]]) -> list[str]:
    lines = ["## Existing Reviewer Context", ""]
    if not threads:
        lines.append("- (none fetched)")
        lines.append("")
        return lines

    for index, thread in enumerate(threads, start=1):
        location = thread["file"]
        if thread["line"]:
            location = f"{location}:{thread['line']}"
        status = "resolved" if thread["resolved"] else "open"
        lines.append(f"### Thread {index} — {location} ({status}, {thread['comment_count']} comments)")
        for message in thread["messages"]:
            author = f" [{message['author']}]" if message["author"] else ""
            lines.append(f"- {author} ({message['classification']}) — {message['body']}")
        lines.append("")
    return lines


def render_review_template() -> list[str]:
    return [
        "## Findings",
        "",
        "- Fill in reviewer findings here, ordered by severity.",
        "",
        "## Open Questions",
        "",
        "- Capture any behavior or contract questions that need clarification before merge.",
        "",
        "## Suggested Comments",
        "",
        "- Draft concrete reviewer comments here. Default to comment drafts first; only post to Codeup when write-comment API support is explicitly wired in and authorized.",
        "",
        "## Change Summary",
        "",
        "- Summarize what this MR changes and what should be verified before approval.",
        "",
    ]


def fetch_review_context(args: argparse.Namespace) -> tuple[dict[str, str], list[dict[str, Any]], dict[str, str], CodeupClient, CodeupRequestContext]:
    ctx, source, repo_info, mr_ref = resolve_request_context(args)
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
    request_ctx = CodeupRequestContext(
        organization_id=ctx.organization_id or config.organization_id,
        repository_id=ctx.repository_id,
        local_id=ctx.local_id,
    )
    change_request = summarize_change_request(client.get_change_request(request_ctx))
    comment_threads: list[dict[str, Any]] = []
    if args.existing_comments:
        payload = client.list_change_request_comments(request_ctx, unresolved_only=False)
        comment_threads = normalize_comment_threads(payload)

    metadata = {
        "api_source": source,
        "api_auth_mode": describe_auth_mode(config),
        "organization_id": request_ctx.organization_id,
        "repository_id": request_ctx.repository_id,
        "local_id": request_ctx.local_id,
    }
    return change_request, comment_threads, metadata, client, request_ctx


def main() -> int:
    args = parse_args()
    try:
        change_request, comment_threads, metadata, client, request_ctx = fetch_review_context(args)
        if args.post_comments:
            posted = post_review_comments(args, client, request_ctx)
            print(
                json.dumps(
                    {
                        "posted": True,
                        "count": len(posted),
                        "items": posted,
                    },
                    ensure_ascii=False,
                    indent=2,
                )
            )
            return 0
        lines: list[str] = []
        lines.extend(render_header(args, metadata, change_request, len(comment_threads)))
        lines.extend(render_existing_comments(comment_threads))
        lines.extend(render_review_template())
        sys.stdout.write("\n".join(lines))
        return 0
    except (CodeupApiError, Exception) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
