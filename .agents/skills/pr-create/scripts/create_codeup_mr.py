#!/usr/bin/env python3

"""Create a Codeup merge request from local git or explicit parameters."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any

CURRENT_DIR = Path(__file__).resolve().parent
SHARED_DIR = CURRENT_DIR.parent.parent / "shared"
if str(SHARED_DIR) not in sys.path:
    sys.path.insert(0, str(SHARED_DIR))

from codeup_client import CodeupApiError, CodeupClient, CodeupRequestContext, describe_auth_mode
from codeup_config import detect_codeup_repo_from_git, detect_current_branch, resolve_codeup_config


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", default=".", help="Repository path.")
    parser.add_argument("--source-branch", default="", help="Source branch.")
    parser.add_argument("--target-branch", default="master", help="Target branch.")
    parser.add_argument("--title", default="", help="Merge request title.")
    parser.add_argument("--description", default="", help="Merge request description.")
    parser.add_argument("--draft", action="store_true", help="Create as draft when API supports it.")
    parser.add_argument("--project-id", default="", help="Repository/project ID override.")
    parser.add_argument("--organization-id", default="", help="Codeup organization ID override.")
    parser.add_argument("--source-project-id", default="", help="Source project ID override.")
    parser.add_argument("--target-project-id", default="", help="Target project ID override.")
    parser.add_argument("--base-url", default="", help="Codeup API base URL override.")
    parser.add_argument("--auth-mode", default="", help="Auth mode override.")
    parser.add_argument("--access-token", default="", help="Access token override.")
    parser.add_argument("--cookie", default="", help="Cookie override.")
    parser.add_argument("--reviewer-user-id", action="append", default=[], help="Reviewer user ID. Repeat for multiple reviewers.")
    parser.add_argument("--work-item-id", action="append", default=[], help="Work item ID. Repeat for multiple work items.")
    parser.add_argument(
        "--gate-result-json",
        default="",
        help="Path to structured self-review gate result JSON. Must indicate self_review_passed=true and ready_to_create=true before real creation.",
    )
    parser.add_argument(
        "--self-review-passed",
        choices=("true", "false"),
        default="",
        help="Explicit self-review verdict when not using --gate-result-json.",
    )
    parser.add_argument(
        "--ready-to-create",
        choices=("true", "false"),
        default="",
        help="Explicit create gate verdict when not using --gate-result-json.",
    )
    parser.add_argument(
        "--blocking-finding",
        action="append",
        default=[],
        help="Blocking self-review finding. Repeat for multiple findings.",
    )
    parser.add_argument(
        "--non-blocking-finding",
        action="append",
        default=[],
        help="Non-blocking self-review finding. Repeat for multiple findings.",
    )
    parser.add_argument(
        "--review-basis-type",
        choices=("intent", "prd", "design", "mr-description", "work-item", "commit-diff"),
        default="",
        help="Primary basis used for review / self-review before creating the MR.",
    )
    parser.add_argument(
        "--review-basis-source",
        default="",
        help="Path, URL, or brief source reference for the review basis.",
    )
    parser.add_argument(
        "--review-basis-sufficient",
        choices=("true", "false"),
        default="",
        help="Whether the available review basis is sufficient for MR creation.",
    )
    parser.add_argument("--dry-run", action="store_true", help="Print payload without calling the API.")
    return parser.parse_args()


def git_output(repo: Path, args: list[str]) -> str:
    result = subprocess.run(
        ["git", "-C", str(repo), *args],
        text=True,
        capture_output=True,
        check=False,
    )
    return result.stdout.strip() if result.returncode == 0 else ""


def ensure_repo(repo: Path) -> None:
    result = subprocess.run(
        ["git", "-C", str(repo), "rev-parse", "--is-inside-work-tree"],
        text=True,
        capture_output=True,
        check=False,
    )
    if result.returncode != 0 or result.stdout.strip() != "true":
        raise ValueError(f"Not a git repository: {repo}")


def build_payload(
    args: argparse.Namespace,
    repo_info_project_id: str,
    source_branch: str,
    *,
    require_project_ids: bool = True,
) -> dict[str, object]:
    source_project_id = args.source_project_id or args.project_id or repo_info_project_id
    target_project_id = args.target_project_id or args.project_id or repo_info_project_id
    if require_project_ids and (not source_project_id or not target_project_id):
        raise ValueError("Missing source/target project ID. Use --project-id or ensure repo remote can be resolved.")
    if not source_branch:
        raise ValueError("Missing source branch. Use --source-branch or run inside a git repository with a checked out branch.")
    if not args.title.strip():
        raise ValueError("Missing merge request title. Use --title.")

    payload: dict[str, object] = {
        "sourceBranch": source_branch,
        "sourceProjectId": source_project_id,
        "targetBranch": args.target_branch,
        "targetProjectId": target_project_id,
        "title": args.title.strip(),
    }
    if args.description.strip():
        payload["description"] = args.description.strip()
    if args.reviewer_user_id:
        payload["reviewerUserIds"] = args.reviewer_user_id
    if args.work_item_id:
        payload["workItemIds"] = ",".join(args.work_item_id)
    if args.draft:
        payload["createFrom"] = "WEB"
    return payload


def resolve_project_id(client: CodeupClient, organization_id: str, repository_id: str) -> str:
    if not repository_id:
        return ""
    if str(repository_id).isdigit():
        return str(repository_id)

    candidates: list[str] = []
    seen: set[str] = set()

    def push(value: str) -> None:
        text = str(value).strip()
        if not text or text in seen:
            return
        seen.add(text)
        candidates.append(text)

    push(repository_id)
    if organization_id and not str(repository_id).startswith(f"{organization_id}/"):
        push(f"{organization_id}/{repository_id}")

    last_error: Exception | None = None
    for candidate in candidates:
        try:
            response = client.get_repository(
                CodeupRequestContext(
                    organization_id=organization_id,
                    repository_id=candidate,
                )
            )
        except CodeupApiError as exc:
            last_error = exc
            continue
        if isinstance(response, dict):
            repo_id = response.get("id")
            if repo_id is not None:
                return str(repo_id)

    if last_error is not None:
        raise last_error
    return str(repository_id)


def parse_bool_flag(value: str) -> bool | None:
    if value == "":
        return None
    return value == "true"


def load_gate_result(args: argparse.Namespace) -> dict[str, Any]:
    if args.gate_result_json:
        gate_path = Path(os.path.expanduser(args.gate_result_json)).resolve()
        gate_payload = json.loads(gate_path.read_text(encoding="utf-8"))
    else:
        gate_payload = {}

    blocking_findings = list(gate_payload.get("blocking_findings", [])) + list(args.blocking_finding)
    non_blocking_findings = list(gate_payload.get("non_blocking_findings", [])) + list(args.non_blocking_finding)
    self_review_passed = parse_bool_flag(args.self_review_passed)
    if self_review_passed is None:
        value = gate_payload.get("self_review_passed")
        self_review_passed = value if isinstance(value, bool) else None
    ready_to_create = parse_bool_flag(args.ready_to_create)
    if ready_to_create is None:
        value = gate_payload.get("ready_to_create")
        ready_to_create = value if isinstance(value, bool) else None
    review_basis_type = str(args.review_basis_type or gate_payload.get("review_basis_type") or "").strip()
    review_basis_source = str(args.review_basis_source or gate_payload.get("review_basis_source") or "").strip()
    review_basis_sufficient = parse_bool_flag(args.review_basis_sufficient)
    if review_basis_sufficient is None:
        value = gate_payload.get("review_basis_sufficient")
        review_basis_sufficient = value if isinstance(value, bool) else None

    return {
        "review_basis_type": review_basis_type,
        "review_basis_source": review_basis_source,
        "review_basis_sufficient": review_basis_sufficient,
        "self_review_passed": self_review_passed,
        "blocking_findings": [str(item) for item in blocking_findings if str(item).strip()],
        "non_blocking_findings": [str(item) for item in non_blocking_findings if str(item).strip()],
        "ready_to_create": ready_to_create,
        "source": str(Path(os.path.expanduser(args.gate_result_json)).resolve()) if args.gate_result_json else "cli",
    }


def gate_verdict(gate: dict[str, Any]) -> tuple[bool, str]:
    if not gate["review_basis_type"]:
        return False, "review_basis_type is required before creating an MR."
    if gate["review_basis_sufficient"] is not True:
        return False, "review_basis_sufficient must be true before creating an MR."
    if gate["self_review_passed"] is not True:
        return False, "self_review_passed must be true before creating an MR."
    if gate["ready_to_create"] is not True:
        return False, "ready_to_create must be true before creating an MR."
    if gate["blocking_findings"]:
        return False, "blocking_findings must be empty before creating an MR."
    return True, ""


def summarize_platform_requirements(response: Any) -> dict[str, Any]:
    if not isinstance(response, dict):
        return {}
    requirements = response.get("platformMergeRequest", {}).get("requirements") if isinstance(response.get("platformMergeRequest"), dict) else None
    if not isinstance(requirements, list):
        requirements = response.get("requirements")
    summary: dict[str, Any] = {}
    all_pass = response.get("allRequirementsPass")
    if isinstance(all_pass, bool):
        summary["allRequirementsPass"] = all_pass
    if isinstance(requirements, list):
        normalized = []
        for item in requirements:
            if isinstance(item, dict):
                normalized.append(
                    {
                        "name": item.get("name") or item.get("type") or item.get("code") or "",
                        "pass": item.get("pass"),
                    }
                )
        if normalized:
            summary["requirements"] = normalized
    return summary


def main() -> int:
    args = parse_args()
    repo = Path(os.path.expanduser(args.repo)).resolve()

    try:
        ensure_repo(repo)
        repo_info = detect_codeup_repo_from_git(str(repo))
        source_branch = args.source_branch or detect_current_branch(str(repo))
        repository_id = args.project_id or (repo_info.repository_path if repo_info else "")
        organization_id = args.organization_id or (repo_info.organization_id if repo_info else "")
        gate = load_gate_result(args)
        gate_passed, gate_message = gate_verdict(gate)

        request_output = {
            "organizationId": organization_id,
            "repositoryPath": repository_id,
            "resolvedRepositoryPath": f"{organization_id}/{repository_id}" if organization_id and repository_id else repository_id,
            "projectId": args.project_id,
            "sourceBranch": source_branch,
            "targetBranch": args.target_branch,
            "gate": gate,
        }

        if args.dry_run and not gate_passed:
            request_output["payload"] = build_payload(args, args.project_id, source_branch, require_project_ids=False)
            print(
                json.dumps(
                    {
                        "dryRun": True,
                        "created": False,
                        "gateVerdict": "BLOCKED",
                        "gateMessage": gate_message,
                        **request_output,
                    },
                    ensure_ascii=False,
                    indent=2,
                )
            )
            return 0

        if not args.dry_run and not gate_passed:
            print(
                json.dumps(
                    {
                        "created": False,
                        "gateVerdict": "BLOCKED",
                        "gateMessage": gate_message,
                        "request": request_output,
                    },
                    ensure_ascii=False,
                    indent=2,
                )
            )
            return 2

        config = resolve_codeup_config(
            {
                "base_url": args.base_url,
                "auth_mode": args.auth_mode,
                "access_token": args.access_token,
                "cookie": args.cookie,
                "organization_id": organization_id,
                "repository_path": repository_id,
                "project_id": args.project_id,
            }
        )

        if args.dry_run:
            preview_project_id = args.project_id or repository_id
            preview_payload = build_payload(
                argparse.Namespace(**{**vars(args), "project_id": preview_project_id}),
                preview_project_id,
                source_branch,
                require_project_ids=False,
            )
            print(
                json.dumps(
                    {
                        "dryRun": True,
                        "created": False,
                        "gateVerdict": "PASSED" if gate_passed else "BLOCKED",
                        "gateMessage": gate_message,
                        "baseUrl": config.base_url,
                        "authMode": describe_auth_mode(config),
                        "organizationId": organization_id or config.organization_id,
                        "repositoryPath": repository_id,
                        "resolvedRepositoryPath": f"{organization_id}/{repository_id}" if organization_id and repository_id else repository_id,
                        "projectId": preview_project_id,
                        "sourceBranch": source_branch,
                        "targetBranch": args.target_branch,
                        "payload": preview_payload,
                        "gate": gate,
                    },
                    ensure_ascii=False,
                    indent=2,
                )
            )
            return 0

        client = CodeupClient(config)
        project_id = resolve_project_id(client, organization_id or config.organization_id, repository_id)
        payload = build_payload(
            argparse.Namespace(**{**vars(args), "project_id": project_id}),
            project_id,
            source_branch,
        )

        output = {
            "baseUrl": config.base_url,
            "authMode": describe_auth_mode(config),
            "organizationId": organization_id or config.organization_id,
            "repositoryPath": repository_id,
            "resolvedRepositoryPath": f"{organization_id}/{repository_id}" if organization_id and repository_id else repository_id,
            "projectId": project_id,
            "sourceBranch": source_branch,
            "targetBranch": args.target_branch,
            "payload": payload,
            "gate": gate,
        }

        if not gate_passed:
            print(
                json.dumps(
                    {
                        "created": False,
                        "gateVerdict": "BLOCKED",
                        "gateMessage": gate_message,
                        "request": output,
                    },
                    ensure_ascii=False,
                    indent=2,
                )
            )
            return 2

        if not config.has_auth:
            raise ValueError("Codeup API create requires authentication. Configure governance.codeupAccessToken or pass --access-token. Use --cookie only if your tenant requires cookie auth.")

        response = client.create_change_request(
            CodeupRequestContext(
                organization_id=organization_id or config.organization_id,
                repository_id=project_id,
            ),
            payload,
        )

        print(
            json.dumps(
                {
                    "created": True,
                    "gateVerdict": "PASSED",
                    "gate": gate,
                    "platformRequirements": summarize_platform_requirements(response),
                    "response": response,
                    "request": output,
                },
                ensure_ascii=False,
                indent=2,
            )
        )
        return 0
    except (CodeupApiError, Exception) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
