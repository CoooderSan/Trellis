#!/usr/bin/env python3

"""Prepare a structured Codeup PR revise plan."""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path
from typing import Any, Optional

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
    parser.add_argument("--repo", default=".", help="Repository path or repository name.")
    parser.add_argument("--pr-url", default="", help="PR URL if available.")
    parser.add_argument("--mr-url", default="", help="MR URL if available.")
    parser.add_argument("--pr-number", default="", help="PR number if available.")
    parser.add_argument("--mr-iid", default="", help="Merge request local ID.")
    parser.add_argument("--scope", default="unresolved", help="Comment scope: unresolved, all, resolved, or file:path.")
    parser.add_argument("--doc", action="append", default=[], help="Intent / design / PRD document path.")
    parser.add_argument("--intent", dest="doc", action="append", help="Alias of --doc.")
    parser.add_argument("--comments-file", default="", help="Path to a JSON or text comment export.")
    parser.add_argument("--comment", action="append", default=[], help="Inline comment text. Repeat for multiple comments.")
    parser.add_argument("--project-id", default="", help="Repository/project ID override.")
    parser.add_argument("--organization-id", default="", help="Codeup organization ID override.")
    parser.add_argument("--base-url", default="", help="Codeup API base URL override.")
    parser.add_argument("--auth-mode", default="", help="Auth mode override.")
    parser.add_argument("--access-token", default="", help="Access token override.")
    parser.add_argument("--cookie", default="", help="Cookie override.")
    parser.add_argument("--use-api", action="store_true", help="Prefer fetching comments from Codeup API.")
    parser.add_argument("--reviewer", default="", help="Filter by reviewer name when possible.")
    parser.add_argument("--update-summary", action="store_true", help="Include suggested update summary.")
    parser.add_argument("--run-tests", action="store_true", help="Include validation checklist for tests.")
    parser.add_argument("--reply-mode", choices=("none", "per-thread"), default="none", help="Reply behavior after revision.")
    parser.add_argument("--reply-text", default="已处理，已在本次提交中调整。", help="Concise reply text for per-thread replies.")
    parser.add_argument("--reply-file", default="", help="Optional JSON file mapping comment IDs to concise reply text.")
    parser.add_argument("--dry-run-replies", action="store_true", help="Validate per-thread reply metadata without posting.")
    parser.add_argument("--post-replies", action="store_true", help="Post concise replies to each selected Codeup thread. Requires complete thread metadata.")
    return parser.parse_args()


def first_non_empty(*values: Any) -> str:
    for value in values:
        if value is None:
            continue
        text = str(value).strip()
        if text:
            return text
    return ""


def detect_classification(text: str) -> str:
    lowered = text.lower()
    for pattern in MUST_FIX_PATTERNS:
        if re.search(pattern, lowered, flags=re.IGNORECASE):
            return "Must Fix"
    for pattern in NEEDS_CONFIRMATION_PATTERNS:
        if re.search(pattern, lowered, flags=re.IGNORECASE):
            return "Needs Confirmation"
    return "Suggestion / Informational"


def normalize_author(value: Any) -> str:
    if isinstance(value, dict):
        return first_non_empty(value.get("name"), value.get("username"), value.get("email"))
    return first_non_empty(value)


def normalize_line(item: dict[str, Any]) -> str:
    line = first_non_empty(item.get("line"), item.get("lineNumber"), item.get("line_number"), item.get("position"))
    if line:
        return line

    position = item.get("position")
    if isinstance(position, dict):
        line_range = position.get("line_range") if isinstance(position.get("line_range"), dict) else {}
        start = line_range.get("start") if isinstance(line_range.get("start"), dict) else {}
        return first_non_empty(
            position.get("new_line"),
            position.get("old_line"),
            start.get("new_line"),
            start.get("old_line"),
        )

    location = item.get("location")
    if isinstance(location, dict):
        return first_non_empty(location.get("located_line_number"), location.get("line_number"))

    return ""


def normalize_file(item: dict[str, Any]) -> str:
    file_path = first_non_empty(item.get("file"), item.get("path"), item.get("filePath"), item.get("file_path"))
    if file_path:
        return file_path

    position = item.get("position")
    if isinstance(position, dict):
        return first_non_empty(position.get("new_path"), position.get("old_path")) or "(general)"

    location = item.get("location")
    if isinstance(location, dict):
        return first_non_empty(location.get("located_file_path"), location.get("file_path")) or "(general)"

    return "(general)"


def normalize_comment(item: Any) -> dict[str, str]:
    if isinstance(item, str):
        return {
            "id": "",
            "body": item.strip(),
            "file": "(unknown file)",
            "line": "",
            "author": "",
            "status": "unknown",
            "resolved": "",
        }

    if not isinstance(item, dict):
        return {
            "id": "",
            "body": str(item).strip(),
            "file": "(unknown file)",
            "line": "",
            "author": "",
            "status": "unknown",
            "resolved": "",
        }

    body = first_non_empty(
        item.get("body"),
        item.get("comment"),
        item.get("content"),
        item.get("text"),
        item.get("note"),
        item.get("htmlValue"),
        item.get("jsonMLValue"),
        item.get("jsonMlValue"),
    )
    resolved_value = item.get("resolved")
    resolved = ""
    status = first_non_empty(item.get("status")) or "unknown"
    if resolved_value is True:
        resolved = "true"
        status = "resolved"
    elif resolved_value is False:
        resolved = "false"
        status = "unresolved"

    comment = {
        "id": first_non_empty(item.get("id"), item.get("note_id"), item.get("discussion_id")),
        "body": body,
        "file": normalize_file(item),
        "line": normalize_line(item),
        "author": normalize_author(item.get("author") or item.get("user") or item.get("creator")),
        "status": status,
        "resolved": resolved,
    }
    comment_biz_id = first_non_empty(item.get("comment_biz_id"), item.get("commentBizId"), item.get("biz_id"), item.get("bizId"))
    root_comment_biz_id = first_non_empty(item.get("root_comment_biz_id"), item.get("rootCommentBizId"))
    parent_comment_biz_id = first_non_empty(
        root_comment_biz_id,
        item.get("parent_comment_biz_id"),
        item.get("parentCommentBizId"),
        comment_biz_id,
    )
    related_biz_id = first_non_empty(
        item.get("related_biz_id"),
        item.get("relatedBizId"),
        item.get("mr_biz_id"),
        item.get("mrBizId"),
        get_nested(item, "related_patchset", "mrBizId"),
        get_nested(item, "relatedPatchset", "mrBizId"),
    )
    comment.update(
        {
            "id": first_non_empty(comment.get("id"), comment_biz_id),
            "comment_biz_id": comment_biz_id,
            "root_comment_biz_id": root_comment_biz_id,
            "parent_comment_biz_id": parent_comment_biz_id,
            "related_biz_id": related_biz_id,
            "comment_type": first_non_empty(item.get("comment_type"), item.get("commentType")),
            "project_id": first_non_empty(item.get("project_id"), item.get("projectId")),
            "from_patchset_biz_id": first_non_empty(item.get("from_patchset_biz_id"), item.get("fromPatchsetBizId")),
            "to_patchset_biz_id": first_non_empty(item.get("to_patchset_biz_id"), item.get("toPatchsetBizId")),
            "related_patchset_mr_biz_id": first_non_empty(
                get_nested(item, "related_patchset", "mrBizId"),
                get_nested(item, "relatedPatchset", "mrBizId"),
            ),
        }
    )
    return comment


def get_nested(item: dict[str, Any], *path: str) -> Any:
    current: Any = item
    for key in path:
        if not isinstance(current, dict):
            return ""
        current = current.get(key)
    return current


def normalize_api_comment(item: Any, *, unresolved_only: bool) -> dict[str, str]:
    comment = normalize_comment(item)
    if not isinstance(item, dict):
        return comment

    comment_biz_id = first_non_empty(
        item.get("comment_biz_id"),
        item.get("commentBizId"),
        item.get("biz_id"),
        item.get("bizId"),
        item.get("id"),
    )
    root_comment_biz_id = first_non_empty(
        item.get("root_comment_biz_id"),
        item.get("rootCommentBizId"),
    )
    parent_comment_biz_id = first_non_empty(
        root_comment_biz_id,
        item.get("parent_comment_biz_id"),
        item.get("parentCommentBizId"),
        comment_biz_id,
    )
    related_biz_id = first_non_empty(
        item.get("related_biz_id"),
        item.get("relatedBizId"),
        item.get("mr_biz_id"),
        item.get("mrBizId"),
        get_nested(item, "related_patchset", "mrBizId"),
        get_nested(item, "relatedPatchset", "mrBizId"),
    )
    resolved_value = item.get("resolved")
    if resolved_value is True:
        comment["resolved"] = "true"
        comment["status"] = "resolved"
    elif resolved_value is False or unresolved_only:
        comment["resolved"] = "false"
        comment["status"] = "unresolved"

    comment.update(
        {
            "id": first_non_empty(comment.get("id"), comment_biz_id),
            "comment_biz_id": comment_biz_id,
            "root_comment_biz_id": root_comment_biz_id,
            "parent_comment_biz_id": parent_comment_biz_id,
            "related_biz_id": related_biz_id,
            "comment_type": first_non_empty(item.get("comment_type"), item.get("commentType")),
            "project_id": first_non_empty(item.get("project_id"), item.get("projectId")),
            "from_patchset_biz_id": first_non_empty(item.get("from_patchset_biz_id"), item.get("fromPatchsetBizId")),
            "to_patchset_biz_id": first_non_empty(item.get("to_patchset_biz_id"), item.get("toPatchsetBizId")),
            "related_patchset_mr_biz_id": first_non_empty(
                get_nested(item, "related_patchset", "mrBizId"),
                get_nested(item, "relatedPatchset", "mrBizId"),
            ),
        }
    )
    return comment


def looks_like_codeup_comment(item: dict[str, Any]) -> bool:
    return any(
        key in item
        for key in (
            "content",
            "body",
            "comment",
            "comment_biz_id",
            "commentBizId",
            "line_number",
            "filePath",
            "location",
        )
    )


def extract_comment_nodes(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, list):
        nodes: list[dict[str, Any]] = []
        for item in payload:
            nodes.extend(extract_comment_nodes(item))
        return nodes

    if not isinstance(payload, dict):
        return []

    for key in ("comments", "records", "items", "data", "result", "comment_list"):
        value = payload.get(key)
        if isinstance(value, list):
            nodes: list[dict[str, Any]] = []
            for item in value:
                nodes.extend(extract_comment_nodes(item))
            if nodes:
                return nodes

    if looks_like_codeup_comment(payload):
        nodes = [payload]
        child_comments = payload.get("child_comments_list")
        if isinstance(child_comments, list):
            for child in child_comments:
                nodes.extend(extract_comment_nodes(child))
        return nodes

    return []


def load_comments_from_json(payload: Any) -> list[dict[str, str]]:
    if isinstance(payload, list):
        return [normalize_comment(item) for item in payload]

    if isinstance(payload, dict):
        for key in ("comments", "data", "items", "records", "notes"):
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


def deduplicate_comments(comments: list[dict[str, str]]) -> list[dict[str, str]]:
    seen: set[tuple[str, str, str, str, str, str, str, str]] = set()
    deduped: list[dict[str, str]] = []
    for item in comments:
        key = (
            item.get("comment_biz_id", ""),
            item.get("parent_comment_biz_id", ""),
            item.get("body", ""),
            item.get("file", ""),
            item.get("line", ""),
            item.get("author", ""),
            item.get("status", ""),
            item.get("resolved", ""),
        )
        if not item.get("body") or key in seen:
            continue
        seen.add(key)
        deduped.append(item)
    return deduped


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


def build_api_client(args: argparse.Namespace) -> tuple[CodeupClient, CodeupRequestContext, dict[str, str]]:
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
    request_ctx = CodeupRequestContext(
        organization_id=ctx.organization_id or config.organization_id,
        repository_id=ctx.repository_id,
        local_id=ctx.local_id,
    )
    metadata = {
        "api_mode": "true",
        "api_source": source,
        "api_auth_mode": describe_auth_mode(config),
        "organization_id": request_ctx.organization_id,
        "repository_id": request_ctx.repository_id,
        "local_id": request_ctx.local_id,
    }
    return CodeupClient(config), request_ctx, metadata


def fetch_comments_from_api(args: argparse.Namespace) -> tuple[list[dict[str, str]], dict[str, str]]:
    scope = args.scope.strip().lower()
    if scope == "resolved":
        raise ValueError("Resolved-only scope is not supported in Codeup API mode yet. Use --comments-file if you need resolved comments.")

    client, request_ctx, metadata = build_api_client(args)
    payload = client.list_change_request_comments(
        request_ctx,
        unresolved_only=scope in {"", "unresolved"},
    )
    raw_nodes = extract_comment_nodes(payload)
    if raw_nodes:
        comments = [normalize_api_comment(item, unresolved_only=scope in {"", "unresolved"}) for item in raw_nodes]
    else:
        comments = [
            {
                "id": "",
                "body": item["body"],
                "file": item["file"],
                "line": item["line"],
                "author": item["author"],
                "status": "unresolved" if scope in {"", "unresolved"} else "unknown",
                "resolved": "false" if scope in {"", "unresolved"} else "",
            }
            for item in normalize_comment_payload(payload)
        ]
    if args.reviewer:
        reviewer = args.reviewer.strip().lower()
        comments = [item for item in comments if reviewer in item["author"].lower()]

    metadata["scope"] = scope or "unresolved"
    return comments, metadata


def collect_comments(args: argparse.Namespace) -> tuple[list[dict[str, str]], dict[str, str]]:
    comments: list[dict[str, str]] = []
    metadata: dict[str, str] = {}
    fallback_available = bool(args.comments_file or args.comment)

    if _should_use_api(args):
        try:
            comments, metadata = fetch_comments_from_api(args)
            if comments:
                return deduplicate_comments(comments), metadata
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
    return deduplicate_comments(comments), metadata


def match_scope(comment: dict[str, str], scope: str) -> bool:
    normalized_scope = scope.strip().lower()
    if not normalized_scope or normalized_scope == "unresolved":
        return comment.get("resolved") != "true"
    if normalized_scope == "resolved":
        return comment.get("resolved") == "true"
    if normalized_scope == "all":
        return True
    if normalized_scope.startswith("file:"):
        target = normalized_scope.split(":", 1)[1].strip()
        return target in comment.get("file", "").lower()
    return True


def selected_comments(args: argparse.Namespace, comments: list[dict[str, str]]) -> list[dict[str, str]]:
    return [item for item in comments if match_scope(item, args.scope)]


def load_reply_overrides(file_path: str) -> dict[str, str]:
    if not file_path:
        return {}
    path = Path(os.path.expanduser(file_path)).resolve()
    if not path.exists():
        raise FileNotFoundError(f"Reply file does not exist: {path}")
    data = json.loads(path.read_text(encoding="utf-8"))
    overrides: dict[str, str] = {}
    if isinstance(data, dict):
        for key, value in data.items():
            text = str(value).strip()
            if text:
                overrides[str(key).strip()] = text
        return overrides
    if isinstance(data, list):
        for item in data:
            if not isinstance(item, dict):
                raise ValueError("Each --reply-file list item must be an object.")
            key = first_non_empty(item.get("comment_biz_id"), item.get("id"), item.get("parent_comment_biz_id"))
            text = first_non_empty(item.get("reply"), item.get("reply_text"), item.get("content"), item.get("body"))
            if key and text:
                overrides[key] = text
        return overrides
    raise ValueError("--reply-file must contain a JSON object or a list of reply mapping objects.")


def reply_text_for_comment(comment: dict[str, str], default_text: str, overrides: dict[str, str]) -> str:
    for key in (
        comment.get("comment_biz_id", ""),
        comment.get("id", ""),
        comment.get("parent_comment_biz_id", ""),
    ):
        if key and key in overrides:
            return overrides[key]
    return default_text.strip()


def reply_readiness(comment: dict[str, str], reply_text: str) -> tuple[bool, list[str]]:
    missing: list[str] = []
    if not comment.get("parent_comment_biz_id"):
        missing.append("parent_comment_biz_id")
    if not comment.get("related_biz_id"):
        missing.append("related_biz_id")
    if not reply_text:
        missing.append("reply_text")
    return not missing, missing


def render_reply_report(args: argparse.Namespace, comments: list[dict[str, str]], posted: Optional[list[dict[str, Any]]] = None) -> str:
    overrides = load_reply_overrides(args.reply_file)
    lines = ["# Codeup PR Reply Report", ""]
    lines.append(f"- Mode: {'post' if args.post_replies else 'dry-run'}")
    lines.append(f"- Selected Comments: {len(comments)}")
    lines.append("")
    posted_by_parent = {
        item.get("parent_comment_biz_id", ""): item
        for item in (posted or [])
    }
    for index, comment in enumerate(comments, start=1):
        text = reply_text_for_comment(comment, args.reply_text, overrides)
        ready, missing = reply_readiness(comment, text)
        parent = comment.get("parent_comment_biz_id", "")
        status = "posted" if parent in posted_by_parent else ("ready" if ready else f"blocked: missing {', '.join(missing)}")
        location = comment.get("file", "(unknown file)")
        if comment.get("line"):
            location = f"{location}:{comment['line']}"
        lines.append(f"{index}. {status} — {location}")
        lines.append(f"   - parent_comment_biz_id: {parent or '(missing)'}")
        lines.append(f"   - related_biz_id: {comment.get('related_biz_id') or '(missing)'}")
        lines.append(f"   - comment_type: {comment.get('comment_type') or '(missing)'}")
        lines.append(f"   - reply: {text or '(empty)'}")
    lines.append("")
    return "\n".join(lines)


def post_thread_replies(args: argparse.Namespace, comments: list[dict[str, str]]) -> list[dict[str, Any]]:
    client, request_ctx, metadata = build_api_client(args)
    overrides = load_reply_overrides(args.reply_file)
    blocked: list[str] = []
    prepared: list[tuple[dict[str, str], str]] = []
    for comment in comments:
        text = reply_text_for_comment(comment, args.reply_text, overrides)
        ready, missing = reply_readiness(comment, text)
        if not ready:
            location = comment.get("file", "(unknown file)")
            if comment.get("line"):
                location = f"{location}:{comment['line']}"
            blocked.append(f"{location}: missing {', '.join(missing)}")
            continue
        prepared.append((comment, text))

    if blocked:
        raise ValueError(
            "Cannot post per-thread replies because some comments are missing required metadata:\n- "
            + "\n- ".join(blocked)
        )

    posted: list[dict[str, Any]] = []
    for comment, text in prepared:
        response = client.create_change_request_comment(
            request_ctx,
            {
                "content": text,
                "comment_type": comment.get("comment_type") or "GLOBAL_COMMENT",
            },
            parent_comment_biz_id=comment["parent_comment_biz_id"],
            related_biz_id=comment["related_biz_id"],
        )
        posted.append(
            {
                "parent_comment_biz_id": comment["parent_comment_biz_id"],
                "related_biz_id": comment["related_biz_id"],
                "payload": {"content": text},
                "response": response,
            }
        )
    return posted


def render_header(args: argparse.Namespace, comments: list[dict[str, str]], metadata: dict[str, str]) -> list[str]:
    lines = ["# Codeup PR Revise Plan", ""]
    lines.append(f"- Repository: {args.repo}")
    lines.append(f"- Scope: {args.scope}")
    if args.pr_url:
        lines.append(f"- PR URL: {args.pr_url}")
    if args.mr_url:
        lines.append(f"- MR URL: {args.mr_url}")
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
    if args.reviewer:
        lines.append(f"- Reviewer Filter: {args.reviewer}")
    if metadata.get("warning"):
        lines.append(f"- Note: {metadata['warning']}")
    lines.append(f"- Selected Comments: {len(comments)}")
    if args.doc:
        lines.append("- Reference Docs:")
        for item in args.doc:
            path = Path(os.path.expanduser(item)).resolve()
            suffix = "" if path.exists() else " (missing)"
            lines.append(f"  - {path}{suffix}")
    lines.append("")
    return lines


def render_comment_item(comment: dict[str, str]) -> list[str]:
    location = comment["file"]
    if comment["line"]:
        location = f"{location}:{comment['line']}"
    author = f" [{comment['author']}]" if comment["author"] else ""
    status = f" ({comment['status']})" if comment.get("status") and comment["status"] != "unknown" else ""
    classification = comment["classification"]
    lines = [f"- {location}{author}{status} — {comment['body']}"]
    if comment.get("parent_comment_biz_id") or comment.get("related_biz_id"):
        replyable = "yes" if comment.get("parent_comment_biz_id") and comment.get("related_biz_id") else "no"
        lines.append(f"  - Reply Thread: {replyable}")
    if classification == "Must Fix":
        lines.append("  - Action: modify the code and add or update validation/tests as needed")
    elif classification == "Needs Confirmation":
        lines.append("  - Action: confirm the intended behavior before changing code")
    else:
        lines.append("  - Action: apply only if it improves readability or consistency without expanding scope")
    return lines


def render_plan(args: argparse.Namespace, comments: list[dict[str, str]], metadata: dict[str, str]) -> str:
    enriched: list[dict[str, str]] = []
    for item in selected_comments(args, comments):
        comment = dict(item)
        comment["classification"] = detect_classification(comment["body"])
        enriched.append(comment)

    must_fix = [item for item in enriched if item["classification"] == "Must Fix"]
    needs_confirmation = [item for item in enriched if item["classification"] == "Needs Confirmation"]
    suggestions = [item for item in enriched if item["classification"] == "Suggestion / Informational"]

    lines = render_header(args, enriched, metadata)

    lines.extend(["## Resolve First", ""])
    if must_fix:
        for item in must_fix:
            lines.extend(render_comment_item(item))
    else:
        lines.append("- (none)")
    lines.append("")

    lines.extend(["## Needs Confirmation", ""])
    if needs_confirmation:
        for item in needs_confirmation:
            lines.extend(render_comment_item(item))
    else:
        lines.append("- (none)")
    lines.append("")

    lines.extend(["## Optional Follow-ups", ""])
    if suggestions:
        for item in suggestions:
            lines.extend(render_comment_item(item))
    else:
        lines.append("- (none)")
    lines.append("")

    lines.extend([
        "## Validation Checklist",
        "",
        "- Re-read the referenced intent / design docs before editing code.",
        "- Keep the change scoped to the selected comments only.",
    ])
    if args.run_tests:
        lines.append("- Run the relevant tests or lint checks after the code changes.")
    else:
        lines.append("- Decide with the user whether tests or lint need to run.")
    lines.append("")

    lines.extend([
        "## Suggested Commit Message",
        "",
        f"fix(review): address Codeup MR {metadata.get('local_id') or args.mr_iid or args.pr_number or 'follow-up'} comments",
        "",
    ])

    if args.update_summary:
        lines.extend([
            "## Suggested Update Summary",
            "",
            f"- addressed {len(must_fix)} must-fix review comment(s)",
            f"- left {len(needs_confirmation)} item(s) pending confirmation",
            "- reply per thread only when `--dry-run-replies` reports complete `parent_comment_biz_id` and `related_biz_id` metadata",
            "",
        ])

    lines.extend([
        "## Execution Notes",
        "",
        "- After code changes are complete, squash the branch into one review-fix commit when the user requested closeout.",
        "- Push rewritten review branches with `git push --force-with-lease`, never plain force push.",
        "- Use `--dry-run-replies` before `--post-replies`; do not post per-thread replies when thread metadata is incomplete.",
        "- If comment intent conflicts with current code or docs, pause and ask for confirmation.",
        "",
    ])
    return "\n".join(lines)


def main() -> int:
    args = parse_args()
    try:
        comments, metadata = collect_comments(args)
        if not comments:
            raise ValueError(
                "No comments were provided or fetched. Use Codeup API mode, --comments-file, or --comment."
            )
        scoped_comments = selected_comments(args, comments)
        if args.dry_run_replies:
            sys.stdout.write(render_reply_report(args, scoped_comments))
            return 0
        if args.post_replies:
            if args.reply_mode != "per-thread":
                raise ValueError("--post-replies requires --reply-mode per-thread.")
            posted = post_thread_replies(args, scoped_comments)
            sys.stdout.write(render_reply_report(args, scoped_comments, posted=posted))
            return 0
        sys.stdout.write(render_plan(args, comments, metadata))
        return 0
    except (CodeupApiError, Exception) as exc:  # pragma: no cover - CLI reporting path
        print(f"error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
