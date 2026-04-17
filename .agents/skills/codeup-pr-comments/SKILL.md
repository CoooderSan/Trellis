---
name: codeup-pr-comments
description: Legacy helper for collecting and summarizing Codeup PR / MR review comments. Prefer `$codeup-pr-revise` for the public author-side feedback workflow; keep this entry for compatibility and standalone comment triage when explicitly needed.
user-invocable: true
requires:
  cli:
    - name: python3
      command: python3
      versionCommand: "python3 --version"
      versionPattern: "Python (\\d+\\.\\d+\\.\\d+)"
      minVersion: "3.9.0"
      installHint: "Install Python 3 via Homebrew: brew install python"
      installCommand: "brew install python"
    - name: git
      command: git
      installHint: "Install Git via Homebrew: brew install git"
      installCommand: "brew install git"
  resources:
    - name: comments-script
      path: ./scripts/prepare_codeup_comments.py
      description: Codeup comment summary script
    - name: codeup-client-module
      path: ../shared/codeup_client.py
      description: Shared Codeup API client module
    - name: codeup-config-module
      path: ../shared/codeup_config.py
      description: Shared Codeup config loader
    - name: codeup-normalizers-module
      path: ../shared/codeup_normalizers.py
      description: Shared Codeup comment normalizers
  settings:
    - key: governance.codeupAccessToken
      host: claude
      required: false
      description: Required when using Codeup API mode
    - key: governance.codeupBaseUrl
      host: claude
      required: false
      description: Optional Codeup API base URL override
    - key: governance.codeupAuthMode
      host: claude
      required: false
      description: Optional auth mode override
  tokens:
    - name: Codeup Access Token (env fallback)
      envVar: CODEUP_ACCESS_TOKEN
      required: false
      description: Environment fallback for Codeup API authentication
---

# Codeup PR Comments (Legacy / Helper)

这个 skill 现在主要是 `codeup-pr-revise` 的内部 helper / 兼容入口，不再作为 Codeup workflow 的对外主 skill 单独介绍。

适用定位：
- 默认作者侧反馈处理：优先使用 `codeup-pr-revise`，由它直接拉 unresolved comments 并推进修订
- 仅在你明确只想“读取/整理评论而暂不改代码”时，才单独使用 `codeup-pr-comments`

因此，对外主模型只保留：`codeup-pr-create`、`codeup-pr-review`、`codeup-pr-revise`。
