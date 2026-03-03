# 结构化决策日志 + 工具调用追踪

## 决策日志（强制输出）

每一步执行前，必须输出结构化决策日志（JSON格式），每个决策说明不超过 50 字。

```json
{
  "step_id": "step-001",
  "goal": "创建用户认证模块",
  "decision_summary": "使用JWT实现无状态认证，避免session存储",
  "tool_name": "write_file",
  "expected_result": "生成auth.ts文件，包含登录/验证逻辑"
}
```

## 工具调用追踪

每次调用工具前，必须输出工具调用元数据：

```json
{
  "event_type": "tool_call",
  "timestamp": "2026-01-22T14:45:00Z",
  "tool": "edit_file",
  "input": {
    "file_path": "/src/auth.ts",
    "operation": "add_function"
  },
  "reason": "实现JWT token验证逻辑",
  "risk_level": "low"
}
```

## 执行要求

- ✅ 先输出决策日志，再执行工具调用
- ✅ 高风险操作（删除、外部API）标记 `risk_level: high`
- ✅ 记录实际输出与预期差异
- ❌ 禁止省略决策理由
- ❌ 禁止静默执行工具
