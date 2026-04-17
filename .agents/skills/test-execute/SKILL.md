---
name: test-execute
description: Execute draft or stable test cases through the team-approved CLI path and collect reusable evidence for later analysis and summary. Use when the user asks to run tests, execute a regression set, or explicitly invokes `$test-execute`.
user-invocable: true
requires:
  cli:
    - name: node
      command: node
      versionCommand: "node --version"
      versionPattern: "v(\\d+\\.\\d+\\.\\d+)"
      minVersion: "18.0.0"
      installHint: "Install Node.js 18+."
    - name: npx
      command: npx
      installHint: "Install Node.js to get npx."
  resources:
    - name: testing-workflow-spec
      path: ../../spec/testing/workflow.md
      description: Core testing workflow specification
    - name: test-report-template
      path: ../../templates/testing/test-report.md
      description: Output template for execution reports
---

# Test Execute

Use this skill when the user wants to run test cases and keep evidence for later analysis and summary.

## 双端触发说明

- Claude Code：优先使用自然语言；若客户端已注册命令，也可使用 `/test-execute`。
- Codex：优先显式使用 `$test-execute`，也支持自然语言。
- 跨端兼容规则：不要假设 `/test-execute` 一定存在；优先兼容 `$skill` 与自然语言。

## When to Use

- "执行这批测试"
- "跑一下 Playwright 回归"
- "收集测试证据"
- `$test-execute`
- `/test-execute`

## Input Modes

### 1. 交互式参数收集

若用户没有一次性给全参数，按以下顺序收集：

1. 目标测试用例、测试目录或执行命令
2. 目标环境
3. 账号、角色或权限前提
4. 测试数据要求
5. 是否需要 trace、截图、日志或其他证据

### 2. 一次性传参

用户一次性提供完整参数时，确认一次即可执行。

示例：

```text
$test-execute target=tests/smoke env=test command="npx playwright test tests/smoke"
```

或自然语言：

```text
请在 test 环境执行 tests/smoke 这批回归，并保留 trace、截图和执行总结。
```

## Preconditions

执行前应确保：
- 目标测试用例或执行命令明确
- 执行环境和必要权限明确
- 如需证据链，已明确哪些证据必须保留
- 若缺少数据前提或环境不可用，要先报告阻塞，而不是假装完成

## Execution Flow

1. Confirm the target test cases, environment, accounts, and data assumptions.
2. Run through the approved CLI path, typically `Playwright Test`.
3. Collect pass / fail summary plus trace, screenshots, logs, and other relevant evidence.
4. Report what was executed, what evidence was collected, and what is missing for later analysis.
5. If execution is blocked, report the blocker and keep partial evidence if any exists.

## Output Requirements

Return:
1. `Execution Target`
2. `Command`
3. `Results Summary`
4. `Evidence`
5. `Execution Notes`
