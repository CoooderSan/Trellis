---
name: codeup-pr-create
description: Create your own Codeup PR / MR from the author perspective. Always complete author-side self-review and a local quality gate before submission, then create the MR through the Codeup API flow only when the gate passes. Use when the user asks to create a Codeup PR/MR, open a merge request, or explicitly invokes `$codeup-pr-create`.
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
    - name: create-mr-script
      path: ../pr-create/scripts/create_codeup_mr.py
      description: Codeup merge request creation script
    - name: codeup-client-module
      path: ../shared/codeup_client.py
      description: Shared Codeup API client module
    - name: codeup-config-module
      path: ../shared/codeup_config.py
      description: Shared Codeup config loader
  settings:
    - key: governance.codeupAccessToken
      host: claude
      required: true
      description: Codeup API token required for MR creation
    - key: governance.codeupBaseUrl
      host: claude
      required: false
      description: Optional Codeup API base URL override
    - key: governance.codeupAuthMode
      host: claude
      required: false
      description: Optional auth mode override
    - key: governance.codeupOrganizationId
      host: claude
      required: false
      description: Optional default organization ID
    - key: governance.codeupRepositoryPath
      host: claude
      required: false
      description: Optional default repository path inside the organization
  tokens:
    - name: Codeup Access Token (env fallback)
      envVar: CODEUP_ACCESS_TOKEN
      required: false
      description: Environment fallback for Codeup API authentication
---

# Codeup PR Create

作者侧创建自己的 Codeup PR / MR。必须先完成 self-review / 质量门禁，并且只有 gate 通过后才允许真实创建。

> 对外主路径：`codeup-pr-create` 负责作者视角的“先自检，再创建”。旧的 `pr-review` 不再作为对外并列主 skill 介绍，而是并入这里的创建前自检步骤。

## 双端触发说明

- Claude Code：优先使用自然语言；若客户端已注册命令，也可使用 `/codeup-pr-create`。
- Codex：优先显式使用 `$codeup-pr-create`，也支持自然语言。
- 跨端兼容规则：不要假设 `/codeup-pr-create` 一定存在；优先兼容 `$skill` 与自然语言。

## When to Use

以下意图触发：
- “帮我创建 Codeup MR”
- “给这个分支开一个合并请求”
- “创建 PR 前先做一遍 self-review”
- `$codeup-pr-create`
- `/codeup-pr-create`

## Execution Flow

1. 确认仓库目录、源分支、目标分支与 review basis。
2. 先执行作者侧 self-review / 质量门禁，并整理结构化 gate 结果：
   - `review_basis_type`
   - `review_basis_source`
   - `review_basis_sufficient`
   - `self_review_passed`
   - `blocking_findings`
   - `non_blocking_findings`
   - `ready_to_create`
3. 若 review basis 不足，或存在 blocking findings，或 `self_review_passed != true`，或 `ready_to_create != true`，立即停止真实创建。
4. 仅当 gate 通过时，整理标题、描述与测试计划。
5. 默认通过旧入口脚本 `skills/pr-create/scripts/create_codeup_mr.py` 调用 Codeup API 创建 MR；真实创建必须显式传入 gate 通过结果。脚本会优先使用显式 `projectId`，否则按 MR URL / remote 中的 `organizationId + repositoryPath` 解析真实项目 ID 后再创建 MR。
6. 多仓库场景下不要把 `codeupProjectId` 固定写进全局 settings；优先从输入 URL（例如 `https://codeup.aliyun.com/<org>/<repo-path>/change/<id>`）或 git remote 推导仓库身份。
7. 创建成功后，单独汇报平台侧 requirements（例如 `allRequirementsPass`、`REVIEWER_APPROVED_CHECK`），不要把它混同为作者侧本地 gate。
8. 若 API 不可用或用户未授权真实创建，则输出可直接手工提交的标题、描述与 payload 草案。

## Review Basis Gate

`codeup-pr-create` 强制要求 **必须有足够的 review basis**，但不强制它一定是独立的 intent / PRD。

允许的 `review_basis_type`：

- `intent`
- `prd`
- `design`
- `mr-description`
- `work-item`
- `commit-diff`

推荐优先级：

1. `intent`
2. `prd`
3. `design`
4. `mr-description`
5. `work-item`
6. `commit-diff`

执行规则：

- 若存在 `intent / PRD / design`，优先使用并在 MR 描述中引用。
- 若没有独立文档，允许使用 `mr-description` 作为主依据，但 MR 描述必须完整覆盖：
  - 变更背景 / 目标
  - 主要变更
  - 影响范围
  - 测试与验证
  - 风险评估
  - 回滚方案
- 若只有零散 commit message 或口头说明，通常不能视为 `review_basis_sufficient=true`。
- `commit-diff` 只能作为补充依据；若业务意图和验收标准无法从 diff 中稳定恢复，不允许直接创建 MR。

脚本 gate 要求：

- `review_basis_type` 必填
- `review_basis_sufficient == true`
- `self_review_passed == true`
- `blocking_findings` 为空
- `ready_to_create == true`

示例：

```json
{
  "review_basis_type": "mr-description",
  "review_basis_source": "Codeup MR body",
  "review_basis_sufficient": true,
  "self_review_passed": true,
  "blocking_findings": [],
  "non_blocking_findings": [],
  "ready_to_create": true
}
```

## Output Requirements

输出结构：

1. `Self Review Findings`
2. `Gate Verdict`
3. `Review Basis`
4. `PR Title`
5. `PR Body`
6. `Created PR`
7. `Platform Requirements`
8. `Follow-ups`
