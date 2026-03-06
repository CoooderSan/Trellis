---
name: trellis:sync-yuque
description: Sync Yuque (语雀) documentation to local cache. Use this skill when the user wants to sync, update, or download Yuque documentation. This is an operational task, not a development task.
user-invocable: true
---

# Governance - Sync Yuque Documentation

This skill syncs Yuque documentation to the local cache directory.

## When to Use

Use this skill when the user says:
- "同步语雀文档"
- "同步语雀"
- "sync yuque"
- "更新语雀文档"
- "下载语雀文档"
- Any request to sync/update/download Yuque docs

## How It Works

1. Read configuration from `~/.claude/settings.json` under the `governance` key
2. Execute the sync script: `node scripts/sync-yuque.js`
3. Documents are cached to `~/.cache/yuque/`

## Configuration Required

The user must have configured in `~/.claude/settings.json`:
```json
{
  "governance": {
    "yuqueToken": "your-yuque-token",
    "yuqueRepo": "https://www.yuque.com/org/repo"
  }
}
```

## Execution

When this skill is triggered:

1. Check if `yuque-dl` is installed globally: `which yuque-dl`
2. **If not installed, automatically install it**: `npm install -g yuque-dl`
3. Read `yuqueToken` and `yuqueRepo` from `~/.claude/settings.json`
4. Execute: `npx yuque-dl --token <token> --repo <repo> --output ~/.cache/yuque/`

**Note**: The skill will automatically install `yuque-dl` if it's not found. No manual installation required.

## Success Response

After successful sync, report:
- Total documents synced
- Cache directory location
- Any failed documents (with reasons)

## Error Handling

If configuration is missing, guide the user to:
1. Add `yuqueToken` and `yuqueRepo` to `~/.claude/settings.json`
2. Or set environment variables `YUQUE_TOKEN` and `YUQUE_REPO`
