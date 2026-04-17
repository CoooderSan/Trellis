# Governance Spec 收口与 Bootstrap 删除

## Goal

将治理约束的模型可见真源统一收口到 `spec/**/*.md`，由 Trellis 作为唯一注入路径，同时删除 ai-governance 中旧的 bootstrap prompt 注入链路，并保留 skills 的 marketplace / bundle / local sync 分发能力。

---

## Background

- **现状与问题**：
  - `Trellis` 已经支持在 Claude / iFlow / OpenCode 会话启动时递归读取 `.trellis/spec/**/*.md` 并注入上下文。
  - `ai-governance` 中核心治理约束已部分迁移到 `spec/governance/*.md` 与 `spec/testing/*.md`。
  - 但 `ai-governance` 仍保留旧的治理运行时：通过 `packages/agent-governance-bootstrap` 的 `SessionStart` hook、`onInit`、`ecochainInit`、`updateGovernance` 直接从 cache/prompts 注入 `governance-master.md`。
  - 同时 `prompts/`、`policy/` 中仍残留部分模型可见治理语义，导致治理真源分裂。
- **为什么需要这个功能**：
  - 让 Trellis 成为唯一模型约束注入路径，避免双重注入与口径漂移。
  - 降低 `ai-governance` 的历史 bootstrap 链路维护成本。
  - 保持 skills 继续通过 marketplace 与 bundle 机制稳定分发。
- **系统/模块**：
  - `Trellis`
  - `ai-governance-and-skills-starter/ai-governance`
  - `packages/agent-governance-bootstrap`
  - marketplace / bundle / local skill sync 链路

---

## Requirements

### 功能需求
- [ ] 将 `ai-governance` 中所有模型可见治理语义收口到 `spec/**/*.md`。
- [ ] 统一治理真源口径，避免 `spec` 与 `policy` 的配额、访问控制等规则冲突。
- [ ] 删除旧的 bootstrap prompt 注入链路，包括 `SessionStart` hook 与基于 `governance-master.md` 的直接会话注入。
- [ ] 保留并对齐 skills 的 marketplace、bundle、local skill sync 分发能力。
- [ ] 更新 Trellis 与 ai-governance 的相关文案，使其明确说明约束来自 `.trellis/spec/**/*.md`，而不是旧 bootstrap 注入。
- [ ] 保证 testing skills 继续复用 `spec/testing/*` 与相关模板，不因治理收口而失效。

### 非功能需求
- **性能**：
  - 不额外引入新的运行时注入链路。
  - 保持现有 Trellis session-start 注入复杂度不显著增加。
- **安全**：
  - 删除历史隐式 prompt 注入后，不降低现有治理约束的可见性与一致性。
  - 不引入新的危险自动化操作。
- **成本**：
  - 优先复用现有 bundle / sync / requires 解析脚本，不重造分发体系。
  - 尽量减少双份文档与双份策略维护成本。

---

## Out of Scope

明确不做什么：
- 不重做 Trellis 官方默认 scaffold（如 `backend/frontend/guides` 的初始化结构）。
- 不重写 marketplace 分发协议或替换为新的注册中心方案。
- 不在本任务中新增与治理收口无关的业务技能。
- 不处理与本次改造无关的发布动作。

---

## Technical Design (Optional)

- **技术方案选择**：
  - 以 `spec/**/*.md` 作为唯一模型可见治理真源。
  - `Trellis` 保持现有递归 spec 注入实现，仅同步文案与必要测试。
  - `ai-governance` 删除旧 bootstrap prompt 注入入口，但保留 skills 分发桥接能力。
- **关键实现细节**：
  - 将 `prompts/governance-master.md` 中剩余独占治理语义拆回 `spec/governance/*.md`。
  - 明确 `policy/*.yml` / `policy/agent.rego` 的角色：若保留，则只能作为派生产物或工具输入，不再作为模型真源。
  - `governance-init` / `governance-update` 等 skill 改为治理缓存刷新、local skill sync、运维提示，不再负责向当前会话拼接治理 prompt。
- **依赖与集成**：
  - 依赖 Trellis 现有 session-start 注入。
  - 依赖 `sync_plugin_bundles.py`、`sync_governance_skills.py`、`generate_requires_actions.py`。
  - 与现有 develop/testing plugin bundle 兼容。

---

## Acceptance Criteria

- **Given** `Trellis` 已支持递归注入 `.trellis/spec/**/*.md`  
  **When** 将 ai-governance 的治理规范安装到 `.trellis/spec/`  
  **Then** Claude / iFlow / OpenCode 会话均能仅依赖 Trellis 注入拿到治理约束。

- **Given** `ai-governance` 仍存在旧 bootstrap prompt 注入链路  
  **When** 完成本次改造  
  **Then** 旧链路被删除或失效，运行时不再直接从 `governance-master.md` 向会话注入 prompt。

- **Given** skills 当前通过 marketplace + bundle + local sync 分发  
  **When** 完成治理收口  
  **Then** public skills 仍可正常生成 bundle、同步到本地目录并被会话调用。

- **指标**（KPI/SLI/SLO）：
  - 治理模型真源唯一化（`spec/**/*.md`）
  - 旧 bootstrap 注入入口清零
  - marketplace / bundle / local sync 主链可用
  - Trellis 注入口径与 README/模板文案一致

---

## Definition of Done

- [ ] 完成 `ai-governance` 中剩余治理语义向 `spec/**/*.md` 的迁移
- [ ] 完成 `policy` 真源角色统一与冲突消除
- [ ] 删除旧 bootstrap prompt 注入链路
- [ ] 保留并验证 skills 分发链路
- [ ] Trellis 与 ai-governance 相关文案更新完成
- [ ] 关键测试与端到端验证通过

---

## Risks & Edge Cases

- **风险点**：
  - 删除旧 loader 后，若 spec 迁移不完整，可能造成治理规则缺失。
  - `policy` 与 `spec` 的真源切换可能影响历史脚本或工具消费方。
  - local skill sync 若误删，可能导致 skills 在当前平台不可见。
- **边界情况**：
  - testing workflow 仍依赖模板文件，需避免把模板误删为“历史产物”。
  - 部分 README / plugin 描述仍引用 SessionStart 与 governance-master，需要同步清理。
  - 当前没有语雀本地缓存，不能依赖语雀作为本次实施前提。
- **降级方案**：
  - 先完成 spec 迁移与文案对齐，再删除旧注入入口。
  - 对旧入口采用“先改为 no-op / 运维提示，再彻底删除”的两阶段策略。
  - 对仍需机器消费的 policy 文件，先保留并标记为派生产物，再决定是否彻底清理。

---

## References

- **语雀文档**：当前无本地缓存（`~/.cache/yuque` 不存在）
- **相关 Issue**：待补充
- **仓库/模块**：
  - `Trellis`
  - `ai-governance-and-skills-starter/ai-governance`
  - `packages/agent-governance-bootstrap`
