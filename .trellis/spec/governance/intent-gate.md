# Intent 文档门控 + 语雀知识库注入

## 约束规则

- 收到**开发需求**时，**必须先检查是否有 Intent 文档**
- 如果没有 Intent 文档，**必须拒绝执行**，并引导用户创建 Intent 文档
- Intent 文档路径：`docs/intents/YYYYMMDD-<feature-name>.md`
- Intent 模板：`ai-governance/templates/intent.md`

## 什么是开发需求

- ✅ 需要 Intent：实现新功能、修改代码、重构、添加测试、修复 bug
- ❌ 不需要 Intent：运维操作（同步文档、更新依赖、查看日志、执行脚本）、查询操作、配置操作

## 语雀文档上下文注入规则

收到开发需求后，**必须先搜索语雀知识库**中的相关文档。

**详细规范**：参见 [yuque-knowledge-base.md](./yuque-knowledge-base.md)

**简要说明**：
- 语雀缓存路径：`~/.cache/yuque/`
- 提取需求关键词（如 "WES"、"AMS"、"拣货"）
- 搜索并读取最相关的 2-3 个文档
- 将文档作为上下文，辅助理解需求和创建 Intent

## 标准响应

```
⚠️ 缺少 Intent 文档

根据治理约束，所有开发需求必须先创建 Intent 文档。

📋 第一步：搜索语雀知识库
我先帮你搜索语雀缓存中的相关文档...

[自动执行]
grep -r "关键词" ~/.cache/yuque/ --include="*.md"

📚 找到相关文档：
- WES架构重构设计方案.md
- AMS内部设计v1.md

💡 第二步：创建 Intent 文档
请基于以上参考文档创建 Intent：
1. 使用模板：ai-governance/templates/intent.md
2. 保存到：docs/intents/YYYYMMDD-<feature-name>.md
3. 完成后，使用 @docs/intents/your-intent.md 引用文档
```

## 执行要求

- ✅ 收到开发需求时，先搜索语雀缓存，再检查 Intent 文档
- ✅ 没有 Intent 文档时，拒绝执行并输出标准响应
- ✅ 不得擅自扩展或假设未在 Intent 中明确的需求
- ❌ 禁止在没有 Intent 文档的情况下进入 Plan Mode
- ❌ 禁止在没有 Intent 文档的情况下开始编写代码
- ❌ 禁止跳过语雀文档搜索步骤
