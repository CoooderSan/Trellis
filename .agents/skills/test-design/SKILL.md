---
name: test-design
description: Design a layered AI-assisted test plan from PRD or intent, explicitly considering existing regression cases and reusable test assets before generating new coverage. Use when the user asks how a change should be tested or explicitly invokes `$test-design`.
user-invocable: true
requires:
  resources:
    - name: testing-workflow-spec
      path: ../../spec/testing/workflow.md
      description: Core testing workflow specification
    - name: testing-layering-spec
      path: ../../spec/testing/layering.md
      description: Test layer selection rules
    - name: test-design-template
      path: ../../templates/testing/test-design.md
      description: Output template for test design
---

# Test Design

Turn `PRD / intent` into a layered test plan and test case strategy before execution or script generation.

## 双端触发说明

- Claude Code：优先使用自然语言；若客户端已注册命令，也可使用 `/test-design`。
- Codex：优先显式使用 `$test-design`，也支持自然语言。
- 跨端兼容规则：不要假设 `/test-design` 一定存在；优先兼容 `$skill` 与自然语言。

## When to Use

- "根据 PRD 设计测试方案"
- "帮我做测试分层"
- "这个需求应该怎么测"
- `$test-design`
- `/test-design`

## Input Modes

### 1. 交互式参数收集

若用户没有一次性给全参数，按以下顺序收集：

1. `PRD / intent` 路径或正文
2. 相关设计文档路径
3. 现有回归用例或测试资产位置
4. 目标环境与测试数据约束
5. 是否只做分层设计，还是同时产出 MVTests 和测试用例草案

### 2. 一次性传参

用户一次性提供完整参数时，确认一次即可执行。

示例：

```text
$test-design doc=docs/intents/20260411-testing-workflow.md regressions=/path/to/tests env=test
```

或自然语言：

```text
请基于 docs/intents/20260411-testing-workflow.md 和现有回归用例目录 /path/to/tests，输出这次变更的测试分层、MVTests 和测试数据要求。
```

## Preconditions

执行前应确保：
- 已有明确的 `PRD / intent` 或等价需求说明
- 若存在现有回归用例或测试资产，优先先读取而不是忽略
- 已明确目标范围，避免把无关模块一起纳入设计
- 若缺少环境、数据或角色前提，要在输出中明确标注缺口

## Execution Flow

1. Read the target `PRD / intent` and related design docs.
2. Inspect existing regression cases and reusable test assets before proposing any new coverage.
3. Classify the change across API / service guards, stable UI regression, natural language drafts, and manual exploration.
4. Produce layered test cases, MVTests, data prerequisites, and reuse suggestions.
5. If inputs are incomplete, state the missing information instead of guessing hidden requirements.

## Output Requirements

Return:
1. `Target And Scope`
2. `Existing Regression Cases`
3. `Layered Test Plan`
4. `Test Cases And MVTests`
5. `Open Risks`
