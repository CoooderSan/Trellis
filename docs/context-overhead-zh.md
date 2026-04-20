# 上下文开销分析

> Trellis 占用多少上下文？详细拆解。

---

## 快速回答

| 场景 | Tokens | 1M 窗口 | 200k 窗口 |
|------|--------|---------|-----------|
| **Session 启动** | ~2,300 | 0.23% | 1.15% |
| **峰值 (Implement 运行时)** | ~6,900 | 0.69% | 3.45% |
| **完整工作流程** | ~4,200 平均 | 0.42% | 2.10% |

**结论**：Trellis 在峰值时占用 **1M 的不到 1%**，或 **200k 的约 3.5%**，其余空间都留给实际工作。

---

## Trellis 上下文机制

### 核心理解：Session start 已切到 index-first

当前 SessionStart hook 只会注入：

- workflow 的**分段索引**，而不是完整 `workflow.md`
- `get_context.py` 输出的当前项目状态
- task status
- 相关 spec `index.md` 入口文件
- 可选的持久化 session-gate 摘要

更细的规则文件不再递归内联，而是由这些 index 按需引导读取。

### 核心理解：Subagent 上下文是独立的

每个 Subagent 运行时有**独立隔离的上下文**，结束后被丢弃：

```
Main Agent (持久)            Subagent (临时)
─────────────────────────   ─────────────────────
│ ~2,300 tokens          │  │ ~4,100 tokens    │
│ ├─ workflow ToC        │  │ ├─ agent prompt  │
│ ├─ current state       │  │ ├─ jsonl 规范    │
│ ├─ task status         │  │ └─ prd.md        │
│ └─ spec indexes        │  └─────────────────────
│                        │       (结束后丢弃)
│ + subagent 输出结果    │
└─────────────────────────
```

只有 Subagent 的**输出结果**会累积到 Main Agent 的对话历史中。

---

## 各 Agent 上下文详解

### Main Agent (人机交互)

通过 `SessionStart` Hook 在会话启动时注入：

| 组件 | Tokens | 1M | 200k |
|------|--------|-----|------|
| workflow 分段索引 | ~120 | 0.01% | 0.06% |
| get_context.py 输出 | ~748 | 0.07% | 0.37% |
| task status + ready block | ~120 | 0.01% | 0.06% |
| frontend/index.md | ~335 | 0.03% | 0.17% |
| backend/index.md | ~352 | 0.04% | 0.18% |
| guides/index.md | ~586 | 0.06% | 0.29% |
| session 包装标签 / 胶水文本 | ~80 | 0.01% | 0.04% |
| **合计** | **~2,341** | **0.23%** | **1.17%** |

以上数字对应默认基线，也就是标准顶层 spec 入口文件的注入成本。当前 `session-start` hook 注入的是 workflow 分段索引、当前项目状态、task status，以及相关 spec `index.md` 入口文件。`frontend/`、`backend/`、`guides/` 仍然作为默认 fallback，而包级 index 可以被 `spec_scope` 或 active task 收窄。更细的规则文件由注入后的 index 按需指向，不再递归内联整棵 `.trellis/spec/**/*.md`。

### Research Agent

用于代码库探索的轻量级 Agent：

| 组件 | Tokens | 1M | 200k |
|------|--------|-----|------|
| research.md (agent prompt) | ~617 | 0.06% | 0.31% |
| 项目结构模板 | ~100 | 0.01% | 0.05% |
| Prompt wrapper | ~225 | 0.02% | 0.11% |
| research.jsonl (可选) | 0-500 | 0-0.05% | 0-0.25% |
| **合计** | **~942-1,442** | **0.09-0.14%** | **0.47-0.72%** |

### Implement Agent

最重的 Agent，携带开发规范：

| 组件 | Tokens | 1M | 200k |
|------|--------|-----|------|
| implement.md (agent prompt) | ~513 | 0.05% | 0.26% |
| Prompt wrapper | ~112 | 0.01% | 0.06% |
| implement.jsonl 内容 | ~3,000-3,500 | 0.30-0.35% | 1.50-1.75% |
| prd.md | ~300 | 0.03% | 0.15% |
| info.md (可选) | 0-500 | 0-0.05% | 0-0.25% |
| **合计** | **~3,925-4,925** | **0.39-0.49%** | **1.96-2.46%** |

### Check Agent

代码质量验证：

| 组件 | Tokens | 1M | 200k |
|------|--------|-----|------|
| check.md (agent prompt) | ~708 | 0.07% | 0.35% |
| Prompt wrapper | ~120 | 0.01% | 0.06% |
| check.jsonl 内容 | ~970-1,500 | 0.10-0.15% | 0.49-0.75% |
| prd.md | ~300 | 0.03% | 0.15% |
| **合计** | **~2,098-2,628** | **0.21-0.26%** | **1.05-1.31%** |

### Debug Agent

问题修复专家：

| 组件 | Tokens | 1M | 200k |
|------|--------|-----|------|
| debug.md (agent prompt) | ~483 | 0.05% | 0.24% |
| Prompt wrapper | ~130 | 0.01% | 0.07% |
| debug.jsonl 内容 | ~970-1,500 | 0.10-0.15% | 0.49-0.75% |
| codex-review-output.txt | 0-2,000 | 0-0.20% | 0-1.00% |
| **合计** | **~1,583-4,113** | **0.16-0.41%** | **0.79-2.06%** |

### Finish Agent

轻量级最终验证 (Check agent 带 `[finish]` 标记)：

| 组件 | Tokens | 1M | 200k |
|------|--------|-----|------|
| check.md (agent prompt) | ~708 | 0.07% | 0.35% |
| Prompt wrapper | ~125 | 0.01% | 0.06% |
| finish-work.md | ~791 | 0.08% | 0.40% |
| prd.md | ~300 | 0.03% | 0.15% |
| **合计** | **~1,924** | **0.19%** | **0.96%** |

---

## 工作流程时间线

典型开发周期中的上下文使用：

| 阶段 | Main Agent | Subagent | 峰值合计 | 1M | 200k |
|------|------------|----------|----------|-----|------|
| Session 启动 | 2,341 | - | 2,341 | 0.23% | 1.17% |
| + Research | 2,341 | 1,000 | 3,341 | 0.33% | 1.67% |
| + Research 输出 | 2,841 | - | 2,841 | 0.28% | 1.42% |
| + Implement | 2,841 | 4,100 | **6,941** | **0.69%** | **3.47%** |
| + Implement 输出 | 3,641 | - | 3,641 | 0.36% | 1.82% |
| + Check | 3,641 | 2,300 | 5,941 | 0.59% | 2.97% |
| + Check 输出 | 4,241 | - | 4,241 | 0.42% | 2.12% |

**峰值使用：~6,941 tokens** (Implement 阶段)

---

## Agent 对比汇总

| Agent | Tokens | 1M | 200k | 用途 |
|-------|--------|-----|------|------|
| Research | ~1,000 | 0.10% | 0.50% | 代码库探索 |
| Finish | ~1,900 | 0.19% | 0.95% | PR 前最终检查 |
| Check | ~2,300 | 0.23% | 1.15% | 质量验证 |
| Debug | ~2,200 | 0.22% | 1.10% | 问题修复 |
| Implement | ~4,100 | 0.41% | 2.05% | 功能开发 |

---

## 优化建议

### 1. 精心配置 JSONL 文件

只包含直接相关的规范：

```jsonl
// 好：只包含任务相关的规范
{"file": ".trellis/spec/frontend/components.md"}

// 避免：workflow.md 已经在 Main Agent 中
{"file": ".trellis/workflow.md"}  // 冗余
```

### 2. 尽量使用轻量级 Agent

- 快速探索 → **Research** (~1,000 tokens)
- 最终验证 → **Finish** (~1,900 tokens)
- 完整质量检查 → **Check** (~2,300 tokens)

### 3. 跳过不必要的阶段

如果你明确知道要做什么：
- 跳过 Research，直接进入 Implement
- 简单任务用 Finish 代替完整 Check

### 4. 监控 JSONL 文件大小

```bash
# 检查 jsonl 文件引用了什么
cat .trellis/tasks/your-task/implement.jsonl

# 测量总上下文
for f in $(jq -r '.file' implement.jsonl); do
  wc -c "$f"
done
```

---

## 常见问题

### Q: 上下文会在多次 Subagent 调用间累积吗？

**不会。** 每个 Subagent 有独立上下文。只有它们的输出会累积到 Main Agent。

### Q: 最小上下文占用是多少？

**默认 index-first 基线约为 ~2,300 tokens。** 如果命中了 package-scoped indexes 或持久化的 session-gate 摘要，会再增加一点，但 Trellis 不再在启动时注入整棵嵌套规则树。

### Q: 32k 上下文的模型能用 Trellis 吗？

**现在宽松得多。** 峰值约 ~6.9k，只占 32k 的约 22%。你仍有约 ~25k 留给实际工作，不过依然建议关闭不用的 MCP 服务，并保持 JSONL 文件精简。

### Q: MCP 对此有什么影响？

**MCP 是独立计算的。** 每个 MCP 工具定义增加 ~100-300 tokens。一个有 10 个工具的服务器增加 ~1,000-3,000 tokens。禁用不用的服务器可以节省上下文。

---

## 总结

| 模型 | Trellis 开销 | 剩余可用 |
|------|-------------|---------|
| **1M tokens** | ~0.7% 峰值 | **~993,059 tokens** |
| **200k tokens** | ~3.5% 峰值 | **~193,059 tokens** |
| **128k tokens** | ~5.4% 峰值 | **~121,059 tokens** |
| **32k tokens** | ~21.7% 峰值 | **~25,059 tokens** |

Trellis 面向现代大上下文模型设计。对 200k+ 上下文来说，即使在峰值阶段，框架开销也已经很小，而 index-first 的 session-start 路径又额外腾出了更多实际工作空间。
