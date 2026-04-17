---
name: pr-create
description: Legacy compatibility entry for author-side PR / MR creation in the Codeup workflow. Prefer `$codeup-pr-create` for the public flow. This wrapper keeps the old trigger available while the public model has converged to create / review / revise.
user-invocable: true
requires:
  skills:
    - name: codeup-pr-create
      path: ../codeup-pr-create
      required: true
      description: Use the converged public skill for author-side create flow
---

# PR Create (Legacy Compatibility)

这是旧入口的兼容 skill。对外的 Codeup 主模型已收敛为：`codeup-pr-create`、`codeup-pr-review`、`codeup-pr-revise`。

- 作者创建自己的 PR / MR：优先使用 `codeup-pr-create`
- reviewer 审核别人的 PR / MR：优先使用 `codeup-pr-review`
- 作者根据 unresolved comments 修订代码：优先使用 `codeup-pr-revise`

本 skill 继续保留，仅用于兼容历史习惯或内部复用；其作者侧 self-review / 质量门禁语义已并入 `codeup-pr-create`。
