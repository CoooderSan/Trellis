---
name: ecochain:governance-init
description: Manually inject governance constraints into the current session. Use when the user wants to load, activate, or refresh governance rules. This is an operational task.
user-invocable: true
---

# Governance - Initialize Constraints

This skill manually injects governance constraints into the current Claude Code session.

## When to Use

Use this skill when the user says:
- "请加载治理约束"
- "激活治理规则"
- "加载治理约束"
- "/ecochain_init"
- "refresh governance"
- Any request to load or activate governance constraints

## What It Does

Loads and displays the governance constraints from:
- `~/.cache/agent-governance/<hash>/prompts/governance-master.md`

## Execution

Read and display the governance constraints file, then confirm:
"✅ 治理约束已加载并激活"

## Note

Governance constraints are automatically loaded via SessionStart hook. This skill is for manual refresh when needed.
