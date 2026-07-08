#!/usr/bin/env python3
"""Governance gate CLI."""

from __future__ import annotations

import argparse
import json
import sys

from common.governance_gate import evaluate_governance_gate, format_gate_block


def main() -> None:
    parser = argparse.ArgumentParser(description="Evaluate Trellis governance gates")
    subparsers = parser.add_subparsers(dest="command", required=True)

    evaluate_parser = subparsers.add_parser("evaluate", help="Evaluate a governance event")
    evaluate_parser.add_argument("--event", required=True, help="Event name, e.g. task_create or task_start")
    evaluate_parser.add_argument("--message", help="Request or task summary")
    evaluate_parser.add_argument("--task-dir", help="Task directory for task-bound events")
    evaluate_parser.add_argument("--json", action="store_true", help="Output JSON")

    args = parser.parse_args()

    if args.command == "evaluate":
        gate = evaluate_governance_gate(
            args.event,
            message=args.message,
            task_dir=args.task_dir,
        )
        if args.json:
            print(json.dumps(gate.as_dict(), indent=2, ensure_ascii=False))
        elif gate.allowed:
            print(f"Governance gate passed {args.event}: {gate.status}")
        else:
            print(format_gate_block(args.event, gate), file=sys.stderr)
        sys.exit(0 if gate.allowed else 1)

    print("Unknown command", file=sys.stderr)
    sys.exit(1)


if __name__ == "__main__":
    main()
