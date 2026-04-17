from __future__ import annotations

import json
import re
from html import unescape
from typing import Any, Optional


CommentRecord = dict[str, str]
CommentThreadRecord = dict[str, Any]

HIGH_RISK_HINTS = (
    "must",
    "need",
    "bug",
    "failure",
    "regression",
    "security",
    "race",
    "null",
    "空",
    "异常",
    "会出错",
    "必须",
)

QUESTION_HINTS = (
    "why",
    "how",
    "question",
    "not sure",
    "consider",
    "是否",
    "为什么",
    "需要确认",
    "确认一下",
)

NOISE_COMMENT_PATTERNS = [

    r"^(?:[-*•]\s*)?已解决[。！!~～…\s]*$",
    r"^(?:[-*•]\s*)?已优化[。！!~～…\s]*$",
    r"^(?:[-*•]\s*)?已修复[。！!~～…\s]*$",
    r"^(?:[-*•]\s*)?已处理[。！!~～…\s]*$",
    r"^(?:[-*•]\s*)?resolved[.!\s]*$",
    r"^(?:[-*•]\s*)?done[.!\s]*$",
    r"^(?:[-*•]\s*)?fixed[.!\s]*$",
    r"^(?:[-*•]\s*)?(已)?mark(ed)?\s+as\s+resolved[.!\s]*$",
]

NOISE_LINE_PATTERNS = [
    r"^(?:[-*•]\s*)?已解决[。！!~～…\s]*$",
    r"^(?:[-*•]\s*)?已优化[。！!~～…\s]*$",
    r"^(?:[-*•]\s*)?已修复[。！!~～…\s]*$",
    r"^(?:[-*•]\s*)?已处理[。！!~～…\s]*$",
    r"^(?:[-*•]\s*)?resolved[.!\s]*$",
    r"^(?:[-*•]\s*)?done[.!\s]*$",
    r"^(?:[-*•]\s*)?fixed[.!\s]*$",
    r"^(?:[-*•]\s*)?已修改[。！!~～…\s]*$",
    r"^(?:[-*•]\s*)?(已)?mark(ed)?\s+as\s+resolved[.!\s]*$",
]

RESOLVED_NOISE_HINTS = (
    "resolved",
    "resolve",
    "已解决",
    "已处理",
    "已修复",
    "已优化",
    "mark as resolved",
    "marked as resolved",
    "resolve discussion",
)


def normalize_comment_payload(payload: Any) -> list[CommentRecord]:
    comments = _extract_comment_nodes(payload)
    records: list[CommentRecord] = []
    seen: set[tuple[str, str, str, str]] = set()
    for comment in comments:
        normalized = normalize_codeup_comment(comment)
        key = (
            normalized["body"],
            normalized["file"],
            normalized["line"],
            normalized["author"],
        )
        if not normalized["body"] or _is_noise_comment(normalized["body"]) or key in seen:
            continue
        seen.add(key)
        records.append(normalized)
    return records


def normalize_comment_threads(payload: Any) -> list[CommentThreadRecord]:
    threads = _extract_comment_threads(payload)
    normalized_threads: list[CommentThreadRecord] = []
    for thread in threads:
        normalized = normalize_codeup_comment_thread(thread)
        if not normalized["messages"]:
            continue
        normalized_threads.append(normalized)
    return normalized_threads


def normalize_codeup_comment_thread(item: Any) -> CommentThreadRecord:
    if not isinstance(item, dict):
        normalized = normalize_codeup_comment(item, include_resolved=True, preserve_noise=True)
        return {
            "file": normalized["file"],
            "line": normalized["line"],
            "resolved": False,
            "comment_count": 1 if normalized["body"] else 0,
            "messages": [
                {
                    "body": normalized["body"],
                    "author": normalized["author"],
                    "file": normalized["file"],
                    "line": normalized["line"],
                    "resolved": False,
                    "comment_time": "",
                    "classification": classify_comment_text(normalized["body"]),
                }
            ] if normalized["body"] else [],
        }

    messages = _flatten_comment_thread_messages(item)
    visible_messages = [message for message in messages if message["body"]]
    file_path = _pick(
        item.get("filePath"),
        item.get("file_path"),
        item.get("path"),
    )
    line = _pick(item.get("line_number"), item.get("line"))
    if not file_path or not line:
        for message in visible_messages:
            if not file_path and message["file"] != "(unknown file)":
                file_path = message["file"]
            if not line and message["line"]:
                line = message["line"]
    return {
        "file": str(file_path).strip() or "(unknown file)",
        "line": str(line).strip(),
        "resolved": _is_thread_resolved(item),
        "comment_count": len(visible_messages),
        "messages": visible_messages,
    }


def normalize_codeup_comment(item: Any, *, include_resolved: bool = False, preserve_noise: bool = False) -> CommentRecord:
    if not isinstance(item, dict):
        return {
            "body": _normalize_body(item, preserve_noise=preserve_noise),
            "file": "(unknown file)",
            "line": "",
            "author": "",
        }

    if not include_resolved and _is_resolved_noise_item(item):
        return {
            "body": "",
            "file": "(unknown file)",
            "line": "",
            "author": "",
        }

    body = _pick_normalized(
        item.get("content"),
        item.get("body"),
        item.get("comment"),
        item.get("text"),
        item.get("note"),
        item.get("htmlValue"),
        item.get("jsonMLValue"),
        item.get("jsonMlValue"),
        preserve_noise=preserve_noise,
    )
    location = item.get("location") if isinstance(item.get("location"), dict) else {}
    author = item.get("author") if isinstance(item.get("author"), dict) else {}

    file_path = _pick(
        item.get("filePath"),
        item.get("file_path"),
        item.get("path"),
        location.get("located_file_path"),
        location.get("file_path"),
    ) or "(unknown file)"

    line = _pick(
        item.get("line_number"),
        item.get("line"),
        location.get("located_line_number"),
        location.get("line_number"),
    )

    author_name = _pick(
        author.get("name"),
        author.get("username"),
        author.get("email"),
        item.get("authorName"),
        item.get("author"),
    )

    return {
        "body": body,
        "file": str(file_path).strip() or "(unknown file)",
        "line": str(line).strip(),
        "author": str(author_name).strip(),
    }


def classify_comment_text(text: str) -> str:
    lowered = str(text or "").lower()
    if any(hint in lowered for hint in HIGH_RISK_HINTS):
        return "Potential Blocking"
    if any(hint in lowered for hint in QUESTION_HINTS):
        return "Open Question"
    return "Suggestion"


def _extract_comment_nodes(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, list):
        nodes: list[dict[str, Any]] = []
        for item in payload:
            nodes.extend(_extract_comment_nodes(item))
        return nodes

    if not isinstance(payload, dict):
        return []

    for key in (
        "comments",
        "records",
        "items",
        "data",
        "result",
        "comment_list",
        "child_comments_list",
    ):
        value = payload.get(key)
        if isinstance(value, list):
            nodes: list[dict[str, Any]] = []
            for item in value:
                nodes.extend(_extract_comment_nodes(item))
            if nodes:
                return nodes

    if _looks_like_comment(payload):
        nodes = [payload]
        child_comments = payload.get("child_comments_list")
        if isinstance(child_comments, list):
            for child in child_comments:
                nodes.extend(_extract_comment_nodes(child))
        return nodes

    return []


def _extract_comment_threads(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, list):
        return [item for item in payload if isinstance(item, dict) and _looks_like_comment(item)]

    if not isinstance(payload, dict):
        return []

    for key in (
        "comments",
        "records",
        "items",
        "data",
        "result",
        "comment_list",
    ):
        value = payload.get(key)
        if isinstance(value, list):
            threads = [item for item in value if isinstance(item, dict) and _looks_like_comment(item)]
            if threads:
                return threads

    if _looks_like_comment(payload):
        return [payload]

    return []


def _flatten_comment_thread_messages(item: dict[str, Any]) -> list[CommentRecord]:
    nodes: list[dict[str, Any]] = [item]
    child_comments = item.get("child_comments_list")
    if isinstance(child_comments, list):
        for child in child_comments:
            if isinstance(child, dict):
                nodes.extend(_flatten_comment_thread_messages(child))

    normalized_messages: list[dict[str, str]] = []
    seen: set[tuple[str, str, str, str, str]] = set()
    for node in sorted(nodes, key=_comment_sort_key):
        normalized = normalize_codeup_comment(node, include_resolved=True, preserve_noise=True)
        key = (
            normalized["body"],
            normalized["file"],
            normalized["line"],
            normalized["author"],
            str(node.get("comment_time") or "").strip(),
        )
        if not normalized["body"] or key in seen:
            continue
        seen.add(key)
        normalized_messages.append(
            {
                "body": normalized["body"],
                "file": normalized["file"],
                "line": normalized["line"],
                "author": normalized["author"],
                "resolved": str(bool(node.get("resolved") is True)).lower(),
                "comment_time": str(node.get("comment_time") or "").strip(),
                "classification": classify_comment_text(normalized["body"]),
            }
        )
    return normalized_messages


def _comment_sort_key(item: dict[str, Any]) -> tuple[str, str, str]:
    return (
        str(item.get("comment_time") or "").strip(),
        str(item.get("comment_biz_id") or item.get("root_comment_biz_id") or "").strip(),
        str(item.get("parent_comment_biz_id") or "").strip(),
    )


def _is_thread_resolved(item: dict[str, Any]) -> bool:
    if item.get("resolved") is True or item.get("discussion_resolved") is True:
        return True
    status = str(item.get("state") or item.get("status") or "").strip().lower()
    return status in {"resolved", "closed"}


def _looks_like_comment(item: dict[str, Any]) -> bool:
    candidate_keys = {
        "content",
        "comment_biz_id",
        "comment_type",
        "line_number",
        "filePath",
        "location",
        "author",
        "body",
    }
    return any(key in item for key in candidate_keys)


def _pick(*values: Any) -> str:
    for value in values:
        if value is None:
            continue
        if isinstance(value, dict):
            continue
        text = str(value).strip()
        if text:
            return text
    return ""


def _pick_first_non_empty(*values: str) -> str:
    for value in values:
        text = str(value).strip()
        if text:
            return text
    return ""


def _pick_normalized(*values: Any, preserve_noise: bool = False) -> str:
    for value in values:
        text = _normalize_body(value, preserve_noise=preserve_noise)
        if text:
            return text
    return ""


def _normalize_body(value: Any, *, preserve_noise: bool = False) -> str:
    if value is None:
        return ""

    if isinstance(value, (dict, list)):
        return _clean_text(_extract_text(value), preserve_noise=preserve_noise)

    text = str(value).strip()
    if not text:
        return ""

    parsed = _parse_json_like(text)
    if parsed is not None:
        extracted = _clean_text(_extract_text(parsed), preserve_noise=preserve_noise)
        if extracted:
            return extracted

    manual_extracted = _extract_json_like_string_field(
        text,
        "plainText",
        "plain_text",
        "text",
        "value",
        "title",
        "htmlValue",
        "html_value",
    )
    if manual_extracted:
        extracted = _clean_text(_extract_text(manual_extracted), preserve_noise=preserve_noise)
        if extracted:
            return extracted

    if "htmlValue" in text or "jsonMLValue" in text or "jsonMlValue" in text:
        reparsed = _parse_json_like(text)
        if reparsed is not None:
            extracted = _clean_text(_extract_text(reparsed), preserve_noise=preserve_noise)
            if extracted:
                return extracted

    if "<" in text and ">" in text:
        return _clean_text(_html_to_text(text), preserve_noise=preserve_noise)

    return _clean_text(text, preserve_noise=preserve_noise)


def _parse_json_like(text: str) -> Optional[Any]:
    stripped = text.strip()
    if not stripped.startswith(("{", "[", '"')):
        return None
    try:
        return json.loads(stripped)
    except json.JSONDecodeError:
        return None


def _extract_json_like_string_field(text: str, *field_names: str) -> str:
    for field_name in field_names:
        pattern = rf'"{re.escape(field_name)}"\s*:\s*"((?:\\.|[^"\\])*)"'
        match = re.search(pattern, text, flags=re.DOTALL)
        if not match:
            continue
        raw_value = match.group(1)
        try:
            return json.loads(f'"{raw_value}"')
        except json.JSONDecodeError:
            continue
    return ""


def _extract_text(value: Any) -> str:
    if value is None:
        return ""

    if isinstance(value, str):
        parsed = _parse_json_like(value)
        if parsed is not None:
            extracted = _extract_text(parsed)
            if extracted:
                return extracted
        if "<" in value and ">" in value:
            return _html_to_text(value)
        return value

    if isinstance(value, dict):
        plain_text = _pick_first_non_empty(
            _extract_text(value.get("plainText")),
            _extract_text(value.get("plain_text")),
            _extract_text(value.get("text")),
            _extract_text(value.get("value")),
            _extract_text(value.get("title")),
            _extract_text(value.get("htmlValue")),
            _extract_text(value.get("html_value")),
        )
        if plain_text:
            return plain_text

        jsonml_text = _pick_first_non_empty(
            _extract_text(value.get("jsonMLValue")),
            _extract_text(value.get("jsonMlValue")),
            _extract_text(value.get("json_ml_value")),
            _extract_text(value.get("content")),
        )
        if jsonml_text:
            return jsonml_text

        parts = [_extract_text(item) for item in value.values()]
        return "\n".join(part for part in parts if part)

    if isinstance(value, list):
        if value and isinstance(value[0], str):
            tag = value[0].lower()
            children = value[1:]
            if children and isinstance(children[0], dict):
                children = children[1:]
            child_parts = [_extract_text(item) for item in children]
            compact_text = "".join(part for part in child_parts if part)
            block_text = "\n".join(part for part in child_parts if part)
            if tag in {"br"}:
                return "\n"
            if tag in {"p", "div", "section", "article", "li", "ul", "ol", "tr", "table", "root"}:
                return f"{block_text}\n" if block_text else "\n"
            if tag in {"a", "span", "strong", "em", "code", "pre", "h1", "h2", "h3", "h4", "h5", "h6"}:
                return compact_text
        parts = [_extract_text(item) for item in value]
        return "\n".join(part for part in parts if part)

    return str(value)


def _html_to_text(raw_html: str) -> str:
    text = raw_html
    text = re.sub(r"<\s*br\s*/?>", "\n", text, flags=re.IGNORECASE)
    text = re.sub(r"<\s*/\s*(p|div|article|li|ol|ul|tr|table|section|h\d)\s*>", "\n", text, flags=re.IGNORECASE)
    text = re.sub(r"<\s*li\b[^>]*>", "- ", text, flags=re.IGNORECASE)
    text = re.sub(r"<[^>]+>", "", text)
    return unescape(text)


def _clean_text(text: str, *, preserve_noise: bool = False) -> str:
    normalized = unescape(str(text)).replace("\xa0", " ")
    normalized = normalized.replace("\r\n", "\n").replace("\r", "\n")
    normalized = re.sub(r"[ \t]+", " ", normalized)
    normalized = re.sub(r"\n{3,}", "\n\n", normalized)
    lines = [line.strip() for line in normalized.splitlines() if line.strip()]
    filtered_lines = lines if preserve_noise else [line for line in lines if not _is_noise_line(line)]
    cleaned = "\n".join(filtered_lines).strip()
    cleaned = re.sub(r"^[-*•]\s*", "", cleaned)
    return cleaned.strip()


def _is_noise_comment(text: str) -> bool:
    candidate = _clean_text(text)
    if not candidate:
        return True
    return any(re.fullmatch(pattern, candidate, flags=re.IGNORECASE) for pattern in NOISE_COMMENT_PATTERNS)


def _is_noise_line(text: str) -> bool:
    candidate = str(text).strip()
    if not candidate:
        return True
    return any(re.fullmatch(pattern, candidate, flags=re.IGNORECASE) for pattern in NOISE_LINE_PATTERNS)


def _is_resolved_noise_item(item: dict[str, Any]) -> bool:
    resolved_value = item.get("resolved")
    discussion_resolved = item.get("discussion_resolved")
    status = str(item.get("status") or item.get("comment_type") or "").strip().lower()
    if resolved_value is True or discussion_resolved is True:
        return True
    if status in {"resolved", "resolve", "system", "system_note"}:
        return True

    body = _pick_normalized(
        item.get("content"),
        item.get("body"),
        item.get("comment"),
        item.get("text"),
        item.get("note"),
        item.get("htmlValue"),
        item.get("jsonMLValue"),
        item.get("jsonMlValue"),
    )
    lowered = body.lower()
    if not lowered:
        return False
    return any(hint in lowered for hint in RESOLVED_NOISE_HINTS) and _is_noise_comment(body)
