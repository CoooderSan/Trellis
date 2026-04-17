from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Mapping, Optional
from urllib import error, parse, request
import ssl

from codeup_config import CodeupConfig, build_auth_headers, normalize_auth_mode


CLIENT_USAGE_HINT = (
    "Use resolve_codeup_config(...) to build config, initialize with CodeupClient(config), "
    "import CodeupRequestContext from codeup_client, and call client methods like "
    "get_repository/get_change_request/create_change_request instead of legacy helpers like "
    "get_config() or client.get()."
)


class CodeupApiError(RuntimeError):
    def __init__(self, message: str, *, status_code: int = 0, payload: Optional[Any] = None):
        super().__init__(message)
        self.status_code = status_code
        self.payload = payload


@dataclass(frozen=True)
class CodeupRequestContext:
    organization_id: str
    repository_id: str
    local_id: str = ""


class CodeupClient:
    def __init__(self, config: CodeupConfig):
        self.config = config
        self._ssl_context = None
        if not config.verify_ssl:
            self._ssl_context = ssl._create_unverified_context()

    def _require_enterprise_context(self, ctx: CodeupRequestContext) -> tuple[str, str]:
        organization_id = ctx.organization_id or self.config.organization_id
        repository_id = ctx.repository_id or self.config.repository_id
        if self.config.uses_codeup_enterprise and not organization_id:
            raise CodeupApiError(
                "Missing Codeup organization ID for enterprise API. Set governance.codeupOrganizationId or pass --organization-id. "
                + CLIENT_USAGE_HINT
            )
        if not repository_id:
            raise CodeupApiError(
                "Missing Codeup repository identifier. Set governance.codeupRepositoryPath / governance.codeupProjectId or pass --project-id. "
                + CLIENT_USAGE_HINT
            )
        return organization_id, repository_id

    def _build_url(self, path: str) -> str:
        return f"{self.config.base_url.rstrip('/')}{path}"

    def _request(
        self,
        method: str,
        path: str,
        *,
        query: Optional[Mapping[str, Any]] = None,
        payload: Optional[Mapping[str, Any]] = None,
    ) -> Any:
        url = self._build_url(path)
        if query:
            params = {key: value for key, value in query.items() if value not in (None, "", [])}
            if params:
                url = f"{url}?{parse.urlencode(params, doseq=True)}"

        headers = build_auth_headers(self.config)
        data = None
        if payload is not None:
            headers["Content-Type"] = "application/json"
            data = json.dumps(payload).encode("utf-8")

        req = request.Request(url, data=data, method=method.upper())
        for key, value in headers.items():
            if value:
                req.add_header(key, value)

        try:
            with request.urlopen(req, timeout=self.config.timeout_sec, context=self._ssl_context) as response:
                raw = response.read().decode("utf-8")
                if not raw:
                    return {}
                try:
                    return json.loads(raw)
                except json.JSONDecodeError as exc:
                    preview = raw.strip().splitlines()[0][:200] if raw.strip() else "(empty body)"
                    raise CodeupApiError(
                        f"Codeup API returned non-JSON response. Check base URL/auth/session. Body preview: {preview}"
                    ) from exc
        except error.HTTPError as exc:
            body = exc.read().decode("utf-8", errors="replace")
            payload_obj: Any = body
            try:
                payload_obj = json.loads(body) if body else {}
            except json.JSONDecodeError:
                payload_obj = body
            message = _extract_error_message(payload_obj) or f"Codeup API request failed with status {exc.code}"
            raise CodeupApiError(message, status_code=exc.code, payload=payload_obj) from exc
        except error.URLError as exc:
            raise CodeupApiError(f"Codeup API request failed: {exc.reason}") from exc

    def get_repository(self, ctx: CodeupRequestContext) -> Any:
        return self._request("GET", build_repository_path(self.config, ctx))

    def get_change_request(self, ctx: CodeupRequestContext) -> Any:
        return self._request("GET", build_change_request_path(self.config, ctx))

    def list_change_request_comments(
        self,
        ctx: CodeupRequestContext,
        *,
        unresolved_only: bool = False,
        comment_type: str = "",
        file_path: str = "",
        state: str = "",
    ) -> Any:
        payload: dict[str, Any] = {}
        if unresolved_only:
            payload["resolved"] = False
        if comment_type:
            payload["comment_type"] = comment_type
        if file_path:
            payload["file_path"] = file_path
        if state:
            payload["state"] = state
        return self._request(
            "POST",
            build_comment_list_path(self.config, ctx),
            payload=payload,
        )

    def create_change_request(self, ctx: CodeupRequestContext, payload: Mapping[str, Any]) -> Any:
        return self._request("POST", build_change_request_collection_path(self.config, ctx), payload=payload)

    def create_change_request_comment(
        self,
        ctx: CodeupRequestContext,
        payload: Mapping[str, Any],
        *,
        parent_comment_biz_id: str = "",
        related_biz_id: str = "",
    ) -> Any:
        if parent_comment_biz_id and not related_biz_id:
            raise CodeupApiError(
                "Replying to a Codeup comment requires related_biz_id from the parent thread. "
                "Fetch the original thread metadata first and pass both parent_comment_biz_id and related_biz_id."
            )
        request_payload = dict(payload)
        if parent_comment_biz_id:
            request_payload["parent_comment_biz_id"] = parent_comment_biz_id
            request_payload["related_biz_id"] = related_biz_id
        return self._request("POST", build_comment_create_path(self.config, ctx), payload=request_payload)


def build_repository_path(config: CodeupConfig, ctx: CodeupRequestContext) -> str:
    repository_id = ctx.repository_id or config.repository_id
    if not repository_id:
        raise CodeupApiError(
            "Missing Codeup repository identifier. Set governance.codeupRepositoryPath / governance.codeupProjectId or pass --project-id. "
            + CLIENT_USAGE_HINT
        )
    if "/" in repository_id and not (ctx.organization_id or config.organization_id):
        raise CodeupApiError(
            "Repository identifier looks like a Codeup repository path but organization ID is missing. "
            "Set governance.codeupOrganizationId or pass --organization-id. "
            + CLIENT_USAGE_HINT
        )
    repository_id = parse.quote(repository_id, safe="")
    if config.is_center_edition or config.uses_codeup_enterprise:
        organization_id = ctx.organization_id or config.organization_id
        if not organization_id:
            raise CodeupApiError(
                "Missing Codeup organization ID for enterprise API. Set governance.codeupOrganizationId or pass --organization-id. "
                + CLIENT_USAGE_HINT
            )
        organization_id = parse.quote(organization_id, safe="")
        return f"/oapi/v1/codeup/organizations/{organization_id}/repositories/{repository_id}"
    return f"/oapi/v1/codeup/repositories/{repository_id}"


def build_change_request_collection_path(config: CodeupConfig, ctx: CodeupRequestContext) -> str:
    return f"{build_repository_path(config, ctx)}/changeRequests"


def build_change_request_path(config: CodeupConfig, ctx: CodeupRequestContext) -> str:
    return f"{build_change_request_collection_path(config, ctx)}/{parse.quote(ctx.local_id, safe='')}"


def build_comment_list_path(config: CodeupConfig, ctx: CodeupRequestContext) -> str:
    return f"{build_change_request_path(config, ctx)}/comments/list"


def build_comment_create_path(config: CodeupConfig, ctx: CodeupRequestContext) -> str:
    return f"{build_change_request_path(config, ctx)}/comments"


def _extract_error_message(payload: Any) -> str:
    if isinstance(payload, dict):
        for key in ("message", "msg", "errorMessage", "error_message"):
            value = payload.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
        for key in ("error", "result", "data"):
            value = payload.get(key)
            if isinstance(value, dict):
                nested = _extract_error_message(value)
                if nested:
                    return nested
    if isinstance(payload, str):
        return payload.strip()
    return ""


def describe_auth_mode(config: CodeupConfig) -> str:
    mode = normalize_auth_mode(config.auth_mode)
    if mode == "yunxiao-token":
        return "x-yunxiao-token"
    if mode == "private-token":
        return "PRIVATE-TOKEN"
    if mode == "bearer":
        return "Authorization: Bearer"
    if mode == "cookie":
        return "Cookie"
    return mode
