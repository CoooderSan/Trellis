---
name: codeup-pr-review
description: Review someone else's Codeup PR / MR from the reviewer perspective, produce findings, prepare comment drafts by default, and post real reviewer comments when the workflow explicitly enters the posting path. Use when the user asks to review a Codeup merge request or explicitly invokes `$codeup-pr-review`.
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
    - name: review-script
      path: ./scripts/prepare_codeup_review.py
      description: Codeup reviewer context script
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
      required: true
      description: Codeup API token used by review scripts
    - key: governance.codeupBaseUrl
      host: claude
      required: false
      description: Optional Codeup API base URL override
    - key: governance.codeupAuthMode
      host: claude
      required: false
      description: Optional Codeup auth mode override
    - key: governance.codeupOrganizationId
      host: claude
      required: false
      description: Optional default Codeup organization ID for enterprise repositories
    - key: governance.codeupRepositoryPath
      host: claude
      required: false
      description: Optional default Codeup repository path inside the organization
---

# Codeup PR Review

reviewer 视角审核别人的 Codeup PR / MR，并形成 findings 与评论建议。默认先生成评论草稿；当工作流显式进入 posting 路径时可真实发评语。

> 对外主路径：`codeup-pr-review` 只处理 reviewer 视角的 review + comment；不要与作者侧 `codeup-pr-create` 的 self-review，或作者侧 `codeup-pr-revise` 的按评论修订混淆。
>
> 默认主路径：先通过 `skills/codeup-pr-review/scripts/prepare_codeup_review.py` 读取目标 MR 与现有评论上下文，输出 findings 和 `Suggested Comments`。当显式传入 posting 参数（如 `--post-comments`）时，调用脚本的真实发评路径。

## 双端触发说明

- Claude Code：优先使用自然语言；若客户端已注册命令，也可使用 `/codeup-pr-review`。
- Codex：优先显式使用 `$codeup-pr-review`，也支持自然语言。
- 跨端兼容规则：不要假设 `/codeup-pr-review` 一定存在；优先兼容 `$skill` 与自然语言。

## When to Use

以下意图触发：
- “帮我 review 这个 Codeup MR”
- “审核一下别人的 PR，并给出 review comments”
- “从 reviewer 视角看这个改动有没有问题”
- `$codeup-pr-review`
- `/codeup-pr-review`

## Execution Flow

1. 确认目标 PR / MR 链接或 ID。
2. 读取相关 intent / PRD / 设计文档；若无文档，明确说明 review 信心下降。
3. 默认通过 `skills/codeup-pr-review/scripts/prepare_codeup_review.py` 调用 Codeup API 获取目标 MR 与现有评论上下文。
4. 解析 existing comments 时，必须按原始 thread 树读取根评论与全部回复，不能仅基于扁平化 comment 列表判断问题是否已解决。
5. 按 findings-first 方式输出 reviewer 结论。
6. 默认先生成 `Suggested Comments` 作为 reviewer comment 草案；当显式进入 posting 路径（如传入 `--post-comments`）时，才执行真实发评语。
7. 真实发评语时必须**优先行级评论（inline / line-level comments）**：能挂具体 file/line 就必须挂到具体位置，不能默认退化成 general/global comment。
8. 当前自动 posting 路径仅支持行级评论；没有定位信息时，保持草稿或要求补充位置，不自动发送 general comment。
9. 若执行 reply comment，必须使用同一 thread 的 `parent_comment_biz_id` 与 `related_biz_id`；缺少 thread 元数据时直接报错，不允许猜测后发送。

## Output Requirements

输出结构：

1. `Findings`
2. `Open Questions`
3. `Suggested Comments`
4. `Change Summary`
