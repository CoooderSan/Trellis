---
name: ecochain:governance-update
description: Update governance constraints from the remote repository. Use when the user wants to refresh or update governance rules from the source. This is an operational task.
user-invocable: true
---

# Governance - Update Constraints

This skill updates governance constraints by pulling the latest version from the remote repository.

## When to Use

Use this skill when the user says:
- "更新治理约束"
- "刷新治理规则"
- "/ecochain_governance_update"
- "update governance"
- "pull latest governance"
- Any request to update governance from remote

## What It Does

1. Navigate to the governance cache directory
2. Pull latest changes from the remote repository
3. Reload the governance constraints

## Execution Steps

```bash
cd ~/.cache/agent-governance/<hash>/
git pull origin master
```

Then confirm:
"✅ 治理约束已更新到最新版本"

## Configuration

Uses `governanceRepoUrl` from `~/.claude/settings.json`:
```json
{
  "governance": {
    "governanceRepoUrl": "https://..."
  }
}
```
