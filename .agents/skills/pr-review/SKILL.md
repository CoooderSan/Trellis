---
name: pr-review
description: Legacy compatibility entry for the old PR review flow. In the converged Codeup model, author-side self-review belongs to `$codeup-pr-create`, while reviewer-side review belongs to `$codeup-pr-review`, which prepares comment drafts by default and posts real comments when the workflow explicitly enters the posting path.
user-invocable: true
requires:
  skills:
    - name: codeup-pr-review
      path: ../codeup-pr-review
      required: true
      description: Use the converged public skill for reviewer-side review flow
---

# PR Review (Legacy Compatibility)

这是旧入口的兼容 skill，不再作为 Codeup workflow 的对外主能力介绍。

当前对外只保留三条主路径：
- `codeup-pr-create`：作者侧 self-review / 质量门禁 + 创建自己的 PR / MR
- `codeup-pr-review`：reviewer 侧审核别人的 PR / MR，默认准备评论草稿；显式进入 posting 路径时可发布评论
- `codeup-pr-revise`：作者侧读取 unresolved comments、修改代码并准备下一次提交

保留本 skill 的目的，是兼容历史调用方式，并继续为 `codeup-pr-create` 的作者侧自检流程提供可复用的 review 上下文准备能力。
