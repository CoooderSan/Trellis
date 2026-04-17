---
name: codeup-pr-revise
description: Revise code based on Codeup PR / MR review comments. Use when the user explicitly invokes `$codeup-pr-revise`, asks to address review feedback, resolve PR comments, or update code according to merged reviewer notes. Supports both interactive parameter collection and one-shot invocation.
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
    - name: revise-script
      path: ./scripts/prepare_codeup_revise.py
      description: Codeup revise plan preparation script
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

# Codeup PR Revise

根据 Codeup PR / MR 评论执行修订，优先聚焦 unresolved 评论，并在修改后汇报处理结果；用户要求收口时，支持 squash commit、`git push --force-with-lease`、以及逐条精简回复 Codeup thread。

> 默认主路径：先通过 Codeup API 拉取 unresolved 评论并整理 revise plan；导出文件或手工粘贴评论只作为 fallback。逐条回复平台 comment 必须显式请求，并且必须先校验 thread 元数据完整。

## 双端触发说明

- Claude Code：优先支持自然语言；若客户端已注册命令，也可使用 `/codeup-pr-revise`。
- Codex：优先使用 `$codeup-pr-revise`，也支持自然语言，如“根据这个 MR 评论修改代码”。
- 跨端兼容规则：不要依赖 `/codeup-pr-revise` 一定存在；优先兼容 `$skill` 与自然语言。

## When to Use

以下意图触发：
- “根据 PR 评论修改代码”
- “处理这个 MR 的 review 意见”
- “帮我解决 unresolved comments”
- `$codeup-pr-revise`
- `/codeup-pr-revise`
- 用户提供评论摘要或 PR / MR 标识，并要求落实到代码修改

## Input Modes

### 1. 交互式参数收集

若用户没有一次性给全参数，按以下顺序收集：

1. 仓库目录
2. PR / MR 链接或 ID
3. 修改范围：全部 unresolved 评论，还是指定评论 / 指定文件
4. 是否已有评论摘要，还是需要先读取评论
5. 相关 intent / PRD / 设计文档路径
6. 是否需要生成建议的 commit message / update summary
7. 是否需要运行测试 / lint
8. 是否需要收口：squash commit 并 `git push --force-with-lease`
9. 是否需要逐条回复 Codeup thread；若需要，必须先 dry-run 校验 `parent_comment_biz_id` 与 `related_biz_id`
10. 是否已配置 Codeup API，或要显式传入认证参数

确认参数后再开始修改。

### 2. 一次性传参

用户一次性提供完整参数时，确认一次即可执行。

示例：

```text
$codeup-pr-revise repo=/path/to/repo mr=123 scope=unresolved doc=docs/prd.md update_summary=true run_tests=true closeout=squash reply=per-thread
```

或自然语言：

```text
请在 /path/to/repo 根据 Codeup MR 123 的 unresolved 评论修改代码，参考 docs/design.md，改完后给我建议的 commit message 和 update summary，并跑测试。
```

## Preconditions

执行前应确保：
- 仓库存在且是 git 仓库
- 评论来源明确：默认可直接读取 Codeup API；若 API 不可用，可退回到用户提供的评论文本 / 文件
- 已阅读相关 intent / PRD / 设计文档；若没有文档，要先说明上下文不足
- 修改范围已确认，避免顺手处理不在范围内的问题
- 若要逐条回复平台 comment，必须由 Codeup API 返回并保留 thread 元数据；只拿到 `comment_biz_id` 不足以安全回复
- 若要 squash / force push，必须确认当前分支是可改写历史的工作分支，且没有不属于本次修订的本地改动

## Execution Flow

1. 默认通过 `skills/codeup-pr-revise/scripts/prepare_codeup_revise.py` 读取 Codeup API 评论并生成 revise plan。
2. 若 API 不可用、无认证，或用户显式给了导出内容，则回退到 `--comments-file` / `--comment`。
3. 筛选目标评论（默认 unresolved）。
4. 将评论转成执行清单，必要时先和用户确认优先级。
5. 逐项修改代码，并记录：
   - 对应评论
   - 修改文件
   - 是否已处理
   - 无法处理的原因
6. 如用户要求，运行相关测试或 lint。
7. 若用户要求逐条回复：
   - 先运行 revise script 的 `--dry-run-replies --reply-mode per-thread`，确认每条目标评论都有 `parent_comment_biz_id` 与 `related_biz_id`
   - 缺少任一字段时，不允许猜测、不允许降级成普通评论；报告缺失字段
   - dry-run 全部通过后，才可用 `--post-replies --reply-mode per-thread` 发送精简回复
8. 输出处理报告，以及建议的 commit message / update summary。
9. 若用户要求收口，按以下顺序执行：
   - 确认目标 base / upstream 与当前分支
   - 确认工作区只包含本次 review 修订
   - 将本次修订整理成一个 commit；若已有多个本次修订 commit，使用 squash 方式合并
   - 使用 `git push --force-with-lease` 推送，禁止使用普通 `--force`

推荐收口命令形态：

```bash
git fetch origin
git status --short
git log --oneline <base>..HEAD
git reset --soft <base>
git commit -m "fix(review): address Codeup MR <id> comments"
git push --force-with-lease origin HEAD:<branch>
```

其中 `<base>` 必须是本次 MR 分支相对目标分支的明确基线，例如 `origin/master`、`origin/main`，或经用户确认的 merge-base。不要在存在用户未确认改动或远端新增提交时改写历史。

## Output Requirements

输出结构：

1. `Resolved Comments`
2. `Pending Comments`
3. `Validation`
4. `Suggested Commit Message`
5. `Suggested Update Summary`

其中每条已处理评论至少包含：
- 评论摘要
- 修改文件与位置
- 处理方式
- 是否已回复 Codeup thread；若未回复，说明缺少的 thread 元数据或跳过原因

逐条回复的默认精简文案：

```text
已处理，已在本次提交中调整。
```

如需针对不同评论使用不同文案，使用 revise script 的 `--reply-file` 提供 `comment_biz_id` 到回复文本的映射。

## Error Handling

- 缺少仓库或 PR / MR 标识：请求补充
- 缺少 Codeup 认证：请求用户补充配置，或改为提供评论导出 / 原文
- 无法访问评论：报告 API 错误，并说明是否已回退到文件 / 文本输入
- 评论与当前代码不匹配：说明差异并暂停确认
- 文档缺失：说明上下文不足，可继续但可能只能做局部修订
- 测试失败：保留修改结果，报告失败原因，不要假装“已完成全部处理”
- thread 元数据不完整：禁止发 reply；输出 `--dry-run-replies` 的缺失字段报告
- `git push --force-with-lease` 失败：不要重试普通 force push；先 fetch 并让用户确认远端新增提交如何处理
