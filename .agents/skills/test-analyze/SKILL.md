---
name: test-analyze
description: Analyze execution results against requirements and existing regression cases, then classify failures and recommend revision, summary, or promotion actions. Use when the user asks to explain a test run, summarize failures, or explicitly invokes `$test-analyze`.
user-invocable: true
requires:
  resources:
    - name: testing-workflow-spec
      path: ../../spec/testing/workflow.md
      description: Core testing workflow specification
    - name: testing-triage-spec
      path: ../../spec/testing/triage.md
      description: Failure triage rules
    - name: testing-promotion-spec
      path: ../../spec/testing/promotion.md
      description: Promotion rules for stable assets
    - name: test-analysis-template
      path: ../../templates/testing/test-analysis.md
      description: Output template for test analysis
---

# Test Analyze

Use this skill when the user wants to explain failures, identify gaps, summarize outcomes, or decide whether draft cases should be revised or promoted.

## 双端触发说明

- Claude Code：优先使用自然语言；若客户端已注册命令，也可使用 `/test-analyze`。
- Codex：优先显式使用 `$test-analyze`，也支持自然语言。
- 跨端兼容规则：不要假设 `/test-analyze` 一定存在；优先兼容 `$skill` 与自然语言。

## When to Use

- "分析这次测试失败"
- "判断这些 case 能不能进回归"
- "帮我做测试归因"
- `$test-analyze`
- `/test-analyze`

## Input Modes

### 1. 交互式参数收集

若用户没有一次性给全参数，按以下顺序收集：

1. 执行结果或测试报告
2. 相关证据位置（trace、截图、日志等）
3. 对应的 `PRD / intent` 或预期行为说明
4. 现有回归用例或基线
5. 是否需要输出修订建议、晋升建议或测试总结

### 2. 一次性传参

用户一次性提供完整参数时，确认一次即可执行。

示例：

```text
$test-analyze report=reports/latest.md doc=docs/intents/20260411-testing-workflow.md baseline=/path/to/tests
```

或自然语言：

```text
请根据最新执行结果、trace 和现有回归基线，分析这次失败属于什么类型，并给出修订和总结建议。
```

## Preconditions

执行前应确保：
- 已有可读的执行结果或失败证据
- 预期行为来源明确，例如 `PRD / intent` 或测试设计结果
- 若存在基线回归用例，应先读取再判断缺口
- 若证据不足，要明确指出不足，而不是给出过度确定的结论

## Execution Flow

1. Read execution results and evidence.
2. Compare behavior against `PRD / intent` and existing regression cases.
3. Assign one primary failure category for each failed run.
4. Recommend revision, draft retention, summary updates, or promotion.
5. If confidence is limited, state the missing evidence and keep the conclusion probabilistic.

## Output Requirements

Return:
1. `Analysis Summary`
2. `Primary Triage`
3. `Coverage Gaps`
4. `Revision Recommendations`
5. `Promotion And Summary Recommendations`
