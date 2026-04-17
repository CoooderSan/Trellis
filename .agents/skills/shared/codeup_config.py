from __future__ import annotations

import json
import os
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping, Optional, Sequence
from urllib.parse import urlparse


DEFAULT_CODEUP_BASE_URL = "https://openapi-rdc.aliyuncs.com"
DEFAULT_TIMEOUT_SEC = 20


def _normalize_base_url(value: str) -> str:
    raw = (value or "").strip()
    if not raw:
        return DEFAULT_CODEUP_BASE_URL
    if not raw.startswith(("http://", "https://")):
        raw = f"https://{raw}"
    return raw.rstrip("/")


def _parse_bool(value: Any, default: bool = True) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    normalized = str(value).strip().lower()
    if normalized in {"1", "true", "yes", "y", "on"}:
        return True
    if normalized in {"0", "false", "no", "n", "off"}:
        return False
    return default


def _pick(*values: Any) -> str:
    for value in values:
        if value is None:
            continue
        text = str(value).strip()
        if text:
            return text
    return ""


def load_governance_settings() -> dict[str, Any]:
    settings_path = Path.home() / ".claude" / "settings.json"
    if not settings_path.exists():
        return {}
    try:
        payload = json.loads(settings_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}
    governance = payload.get("governance")
    return governance if isinstance(governance, dict) else {}


@dataclass(frozen=True)
class CodeupConfig:
    base_url: str
    auth_mode: str
    access_token: str
    cookie: str
    organization_id: str
    repository_id: str
    project_id: str
    timeout_sec: int
    verify_ssl: bool

    @property
    def is_center_edition(self) -> bool:
        return bool(self.organization_id)

    @property
    def uses_codeup_enterprise(self) -> bool:
        parsed = urlparse(self.base_url)
        return parsed.netloc.endswith("codeup.aliyun.com")

    @property
    def has_auth(self) -> bool:
        if self.auth_mode == "cookie":
            return bool(self.cookie)
        return bool(self.access_token)


@dataclass(frozen=True)
class CodeupRepoInfo:
    remote_url: str
    base_url: str
    organization_id: str
    repository_path: str


@dataclass(frozen=True)
class CodeupMergeRequestRef:
    raw_url: str
    base_url: str
    organization_id: str
    repository_path: str
    local_id: str


AUTH_MODE_ALIASES = {
    "": "yunxiao-token",
    "yunxiao": "yunxiao-token",
    "x-yunxiao-token": "yunxiao-token",
    "personal-access-token": "yunxiao-token",
    "private": "private-token",
    "private-token": "private-token",
    "bearer": "bearer",
    "cookie": "cookie",
}


def normalize_auth_mode(value: str) -> str:
    normalized = (value or "").strip().lower()
    return AUTH_MODE_ALIASES.get(normalized, normalized or "yunxiao-token")


def build_auth_headers(config: CodeupConfig) -> dict[str, str]:
    headers: dict[str, str] = {"Accept": "application/json"}
    mode = normalize_auth_mode(config.auth_mode)
    if mode == "cookie":
        if config.cookie:
            headers["Cookie"] = config.cookie
        return headers
    if not config.access_token:
        return headers
    if mode == "yunxiao-token":
        headers["x-yunxiao-token"] = config.access_token
    elif mode == "private-token":
        headers["PRIVATE-TOKEN"] = config.access_token
    elif mode == "bearer":
        headers["Authorization"] = f"Bearer {config.access_token}"
    else:
        headers["x-yunxiao-token"] = config.access_token
    return headers


def resolve_codeup_config(cli_overrides: Optional[Mapping[str, Any]] = None) -> CodeupConfig:
    overrides = dict(cli_overrides or {})
    settings = load_governance_settings()

    env = os.environ
    base_url = _normalize_base_url(
        _pick(
            overrides.get("base_url"),
            settings.get("codeupBaseUrl"),
            env.get("CODEUP_BASE_URL"),
        )
    )
    auth_mode = normalize_auth_mode(
        _pick(
            overrides.get("auth_mode"),
            settings.get("codeupAuthMode"),
            env.get("CODEUP_AUTH_MODE"),
            "yunxiao-token",
        )
    )
    access_token = _pick(
        overrides.get("access_token"),
        settings.get("codeupAccessToken"),
        env.get("CODEUP_ACCESS_TOKEN"),
    )
    cookie = _pick(
        overrides.get("cookie"),
        settings.get("codeupCookie"),
        env.get("CODEUP_COOKIE"),
    )
    organization_id = _pick(
        overrides.get("organization_id"),
        settings.get("codeupOrganizationId"),
        env.get("CODEUP_ORGANIZATION_ID"),
    )
    repository_id = _pick(
        overrides.get("repository_id"),
        overrides.get("repository_path"),
        settings.get("codeupRepositoryId"),
        settings.get("codeupRepositoryPath"),
        env.get("CODEUP_REPOSITORY_ID"),
        env.get("CODEUP_REPOSITORY_PATH"),
    )
    project_id = _pick(
        overrides.get("project_id"),
        env.get("CODEUP_PROJECT_ID"),
    )
    timeout_raw = _pick(
        overrides.get("timeout_sec"),
        settings.get("codeupApiTimeoutSec"),
        env.get("CODEUP_API_TIMEOUT_SEC"),
        str(DEFAULT_TIMEOUT_SEC),
    )
    verify_ssl = _parse_bool(
        overrides.get("verify_ssl")
        if overrides.get("verify_ssl") is not None
        else settings.get("codeupVerifySsl", env.get("CODEUP_VERIFY_SSL")),
        default=True,
    )

    try:
        timeout_sec = max(1, int(str(timeout_raw).strip()))
    except ValueError:
        timeout_sec = DEFAULT_TIMEOUT_SEC

    return CodeupConfig(
        base_url=base_url,
        auth_mode=auth_mode,
        access_token=access_token,
        cookie=cookie,
        organization_id=organization_id,
        repository_id=repository_id,
        project_id=project_id,
        timeout_sec=timeout_sec,
        verify_ssl=verify_ssl,
    )


def parse_codeup_remote_url(remote_url: str) -> Optional[CodeupRepoInfo]:
    raw = (remote_url or "").strip()
    if not raw:
        return None

    scp_match = re.match(r"^(?P<user>[^@]+)@(?P<host>[^:]+):(?P<path>.+)$", raw)
    if scp_match:
        host = scp_match.group("host")
        repo_path = scp_match.group("path")
        base_url = f"https://{host}"
    else:
        parsed = urlparse(raw)
        if not parsed.scheme or not parsed.netloc:
            return None
        host = parsed.netloc
        base_url = f"{parsed.scheme}://{host}"
        repo_path = parsed.path.lstrip("/")

    if not host.endswith("codeup.aliyun.com"):
        return None

    normalized_path = repo_path[:-4] if repo_path.endswith(".git") else repo_path
    segments = [segment for segment in normalized_path.split("/") if segment]
    if len(segments) < 2:
        return None

    organization_id = segments[0]
    repository_path = "/".join(segments[1:])
    if not repository_path:
        return None
    return CodeupRepoInfo(
        remote_url=raw,
        base_url=base_url,
        organization_id=organization_id,
        repository_path=repository_path,
    )


def detect_codeup_repo_from_git(repo_path: str) -> Optional[CodeupRepoInfo]:
    repo = Path(os.path.expanduser(repo_path)).resolve()
    if not repo.exists():
        return None

    remotes: Sequence[str] = ("origin", "upstream")
    for remote in remotes:
        try:
            result = subprocess.run(
                ["git", "-C", str(repo), "remote", "get-url", remote],
                text=True,
                capture_output=True,
                check=False,
            )
        except OSError:
            return None
        if result.returncode != 0:
            continue
        info = parse_codeup_remote_url(result.stdout.strip())
        if info:
            return info
    return None


def detect_current_branch(repo_path: str) -> str:
    repo = Path(os.path.expanduser(repo_path)).resolve()
    result = subprocess.run(
        ["git", "-C", str(repo), "rev-parse", "--abbrev-ref", "HEAD"],
        text=True,
        capture_output=True,
        check=False,
    )
    if result.returncode != 0:
        return ""
    return result.stdout.strip()


def parse_change_request_url(url: str) -> Optional[CodeupMergeRequestRef]:
    raw = (url or "").strip()
    if not raw:
        return None

    parsed = urlparse(raw)
    if not parsed.scheme or not parsed.netloc:
        return None

    segments = [segment for segment in parsed.path.split("/") if segment]
    if len(segments) < 3:
        return None

    markers = {"merge_requests", "changeRequests", "pulls", "merge-requests", "change"}
    marker_index = next((idx for idx, segment in enumerate(segments) if segment in markers), -1)
    if marker_index <= 0 or marker_index + 1 >= len(segments):
        return None

    organization_id = segments[0]
    repository_path = "/".join(segments[1:marker_index])
    if not repository_path:
        return None
    local_id = segments[marker_index + 1]

    return CodeupMergeRequestRef(
        raw_url=raw,
        base_url=f"{parsed.scheme}://{parsed.netloc}",
        organization_id=organization_id,
        repository_path=repository_path,
        local_id=local_id,
    )
