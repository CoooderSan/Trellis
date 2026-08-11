#!/usr/bin/env python3
"""CLI adapter for the Trellis governance gate."""

from __future__ import annotations

import argparse
import json
import sys

from common.governance_gate import evaluate_governance_gate, format_gate_block


def main() -> None:
    parser = argparse.ArgumentParser(description="Evaluate Trellis governance gates")
    parser.add_argument("--event", required=True)
    parser.add_argument("--message")
    parser.add_argument("--task-dir")
    parser.add_argument("--classification")
    parser.add_argument("--product-intent-link")
    parser.add_argument("--json", action="store_true")
    argv = sys.argv[1:]
    if argv[:1] == ["evaluate"]:
        argv = argv[1:]
    args = parser.parse_args(argv)

    gate = evaluate_governance_gate(
        args.event,
        message=args.message,
        task_dir=args.task_dir,
        classification=args.classification,
        product_intent_link=args.product_intent_link,
    )
    if args.json:
        print(json.dumps(gate.as_dict(), indent=2, ensure_ascii=False))
    elif gate.allowed:
        print(f"Governance gate passed {args.event}: {gate.status}")
    else:
        print(format_gate_block(args.event, gate), file=sys.stderr)
    raise SystemExit(0 if gate.allowed else 1)


if __name__ == "__main__":
    main()
