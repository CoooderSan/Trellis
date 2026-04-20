#!/usr/bin/env python3
"""Session gate CLI."""

from __future__ import annotations

import argparse
import json
import sys

from common.session_gate import (
    clear_gate_state,
    inspect_request,
    load_gate_state,
    set_gate_result,
    state_as_json,
    summarize_gate_state,
)


VALID_STATUSES = {"needs_review", "ready", "blocked", "not_required", "not_evaluated"}


def main() -> None:
    parser = argparse.ArgumentParser(description="Inspect and persist Trellis session gate state")
    subparsers = parser.add_subparsers(dest="command", required=True)

    inspect_parser = subparsers.add_parser("inspect", help="Inspect the current request and seed gate state")
    inspect_parser.add_argument("--message", "-m", required=True, help="Short summary of the current user request")
    inspect_parser.add_argument("--json", action="store_true", help="Output JSON")

    show_parser = subparsers.add_parser("show", help="Show persisted gate state")
    show_parser.add_argument("--json", action="store_true", help="Output JSON")

    set_parser = subparsers.add_parser("set", help="Persist the reviewed gate result")
    set_parser.add_argument("--status", required=True, choices=sorted(VALID_STATUSES - {"not_evaluated"}))
    set_parser.add_argument("--summary", required=True, help="Short summary of the reviewed gate result")
    set_parser.add_argument("--blocker", action="append", default=[], help="Blocking item to persist")
    set_parser.add_argument("--doc", action="append", help="Applicable rule document path (repeatable)")
    set_parser.add_argument("--next", dest="next_step", help="Next step after this gate result")
    set_parser.add_argument("--request", help="Override stored request summary")
    set_parser.add_argument("--task-type", dest="task_type", help="Override stored task type")
    set_parser.add_argument("--json", action="store_true", help="Output JSON")

    clear_parser = subparsers.add_parser("clear", help="Clear persisted gate state")
    clear_parser.add_argument("--json", action="store_true", help="Output JSON")

    args = parser.parse_args()

    if args.command == "inspect":
        state = inspect_request(args.message)
        if args.json:
            print(json.dumps(state, indent=2, ensure_ascii=False))
        else:
            print(summarize_gate_state(state))
        return

    if args.command == "show":
        state = load_gate_state()
        if args.json:
            print(json.dumps(state_as_json(state), indent=2, ensure_ascii=False))
        else:
            print(summarize_gate_state(state))
        return

    if args.command == "set":
        state = set_gate_result(
            args.status,
            args.summary,
            blockers=args.blocker,
            docs=args.doc,
            next_step=args.next_step,
            request=args.request,
            task_type=args.task_type,
        )
        if args.json:
            print(json.dumps(state, indent=2, ensure_ascii=False))
        else:
            print(summarize_gate_state(state))
        return

    if args.command == "clear":
        success = clear_gate_state()
        payload = {"ok": success}
        if args.json:
            print(json.dumps(payload, indent=2, ensure_ascii=False))
        else:
            print("Cleared session gate state" if success else "No session gate state to clear")
        return

    print("Unknown command", file=sys.stderr)
    sys.exit(1)


if __name__ == "__main__":
    main()
