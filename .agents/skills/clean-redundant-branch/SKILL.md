---
name: clean-redundant-branch
description: Scan all Git repositories under a target directory, compare local tracking branches with the remote state, and prepare a cleanup report for local branches whose upstream branch is gone. Use when the user wants to clean redundant branches, prune stale local branches, or batch-clean multiple repositories. This is an operational maintenance task and requires explicit human confirmation before any deletion. Supports both Codex and Claude Code.
user-invocable: true
requires:
  cli:
    - name: git
      command: git
      installHint: "Install Git via Homebrew: brew install git"
      installCommand: "brew install git"
---

# Clean Redundant Branch

扫描目标目录下的多个 Git 仓库，整理“远程分支已不存在”的本地分支清理报告，并在人工确认后再执行删除。

> 默认主路径：先扫描并输出报告，不直接删除任何分支。只有在用户明确确认后，才允许执行删除命令。

## 双端触发说明

- Claude Code：优先支持自然语言；若客户端已注册命令，也可使用 `/clean-redundant-branch`。
- Codex：优先使用 `$clean-redundant-branch`，也支持自然语言，如“扫描这个目录下所有仓库并清理远程不存在的本地分支”。
- 跨端兼容规则：不要依赖 `/clean-redundant-branch` 一定存在；优先兼容 `$skill` 与自然语言。

## When To Use

Use this skill when the user says:

- "清理无用分支"
- "删除远程不存在的本地分支"
- "扫描目录下所有仓库并清理分支"
- "clean redundant branches"
- "delete local branches whose upstream is gone"
- Any request to batch-clean stale local branches across multiple repositories

## Preconditions

执行前应确保：

- 已明确目标根目录；若用户未提供，默认使用当前工作目录
- 目标目录下允许遍历多个仓库
- 当前任务目标是“清理冗余分支”，而不是顺手处理其他 Git 问题
- 用户已知晓：第一阶段只出报告，不做删除

## Safety Rules

1. 第一阶段必须是 report-only，不得直接删除任何分支。
2. 判断前必须先执行 `git fetch <remote> --prune`，刷新远程状态。
3. 只有 upstream 状态为 `gone` 的本地分支，才可进入候选集合。
4. 永远不要删除当前检出的分支。
5. 如果分支尚未合并到默认分支，应在报告中标记为高风险，不能直接删除。
6. 删除动作必须在报告展示后，得到用户明确确认才能执行。
7. 若涉及高风险分支，执行前要再次提示风险，不能默认使用强制删除。

## Workflow

### Phase 1: Report Only

```bash
find /path/to/repos -type d -name .git -prune
```

For each repository found under the target directory:

1. Enter the repository root
2. Run:

```bash
git fetch origin --prune
git branch -vv
```

3. Identify local branches whose tracking info contains `gone`
4. Classify each branch:

- `safe-candidate`: upstream is gone, branch is not current, and branch is already merged into default branch
- `needs-confirmation`: upstream is gone but branch may still contain unmerged commits
- `skip`: current branch or branch without upstream `gone`

### Phase 2: Ask For Human Confirmation

After the report is prepared, stop and ask the user whether to proceed.

Only after explicit confirmation may the skill run deletion commands such as:

```bash
git branch -d <branch>
```

If the user explicitly accepts force deletion for risky branches, explain the risk first and then use:

```bash
git branch -D <branch>
```

### Phase 3: Execute Deletion After Confirmation

只有在用户明确确认后，才执行删除。

执行时遵循：

1. 优先使用 `git branch -d <branch>`
2. 仅在用户明确接受风险后，才可对高风险分支使用 `git branch -D <branch>`
3. 删除完成后输出结果汇总，不要省略失败项

## Response Format

The first response must be a cleanup report that includes:

1. Target root directory
2. Number of repositories scanned
3. Branches grouped by repository
4. `safe-candidate` branches
5. `needs-confirmation` branches
6. Any repositories or branches skipped, with reasons
7. A clear confirmation question asking whether deletion should proceed

The second response, after explicit confirmation, should include:

1. Branches actually deleted
2. Branches kept
3. Any deletion failures
