# Intent: 合并上游 Trellis 到当前 fork，并收敛本地差异

## Goal

将上游 Trellis 的最新可用能力合并到当前 `@ecochain/trellis` fork 中，同时收敛不再需要的本地改动，仅保留对当前团队仍有必要的最小差异。

---

## Background

- **现状与问题**：
  - 当前 `Trellis` 项目是基于上游仓库的 fork，并包含团队历史上的定制改动。
  - 已确认：对于“团队治理约束在 init 时注入项目”这件事，官方 Trellis 的 `custom spec/source` 已可承载，不必继续依赖专门的 governance 注入链路。
  - 当前 fork 中部分治理相关改动与官方能力重复，且存在实现与预期不一致的问题。
  - 同时，上游已有新增能力需要吸收，例如：
    - `--registry` custom source / template 支持
    - task lifecycle hooks / Linear sync
    - parent-child subtask 支持
- **为什么需要这个功能**：
  - 减少长期维护 fork 的负担
  - 回归官方主路径，降低自定义链路失效风险
  - 保留团队真正需要的最小自定义能力
- **系统/模块**：
  - 仓库：`Trellis`
  - 上游：`mindfold-ai/Trellis`
  - 当前 fork 包：`@ecochain/trellis`

---

## Requirements

### 功能需求
- [ ] 分析当前 fork 与 upstream 的差异，明确：
  - 可直接回归官方的部分
  - 必须保留的本地能力
  - 需重做或重接的差异点
- [ ] 合并上游核心能力到当前 fork。
- [ ] 明确并处理治理相关差异：
  - 不再以自定义 governance 注入链路作为主路径
  - 回归 Trellis 官方 `custom spec/source` 作为项目约束注入方式
- [ ] 保留或最小化实现当前仍需的自定义能力，重点包括：
  - `Codeup` 作为 custom source / provider 的支持（如官方仍未覆盖）
  - 其他明确仍需保留的企业内部适配能力
- [ ] 确保合并后以下主路径仍成立：
  - `trellis init`
  - 自定义 spec/source 初始化
  - Claude Code 配置生成
  - 当前包的基本构建与发布流程
- [ ] 更新相关文档，说明当前 fork 与 upstream 的差异边界。

### 非功能需求
- **性能**：
  - 合并不应显著增加 init 或常用命令的复杂度。
- **安全**：
  - 不引入对敏感路径、危险命令的额外风险。
- **成本**：
  - 优先减少长期维护分叉的成本；不保留已被官方覆盖的改动。

---

## Out of Scope

明确不做什么：
- 不在本任务中重构 `ai-governance` 仓库内容。
- 不在本任务中重写 plugin / market 分发体系。
- 不在本任务中处理与本次合并无关的功能优化。
- 不要求本任务完成所有历史分支清理或发布动作。

---

## Technical Design (Optional)

- **技术方案选择**：
  - 以 upstream/main 为基线进行合并或择取提交。
  - 对本地差异按“保留 / 删除 / 重实现”分类处理。
- **关键实现细节**：
  - 对治理相关定制逻辑进行去主路径化：
    - `.governance-repo`
    - `downloadGovernanceRepo()`
    - `.trellis/spec/governance` 专用同步链路
  - 优先使用官方 `custom spec/source` 承载团队 governance 注入。
  - 若官方对 `Codeup` source 不完整，则仅保留最小必要的 `Codeup` provider 适配。
- **依赖与集成**：
  - 依赖 upstream Trellis 当前结构与接口
  - 与 `ai-governance` 仓库新的 spec 主入口方案保持兼容
  - 与当前私有 npm 发布方式保持兼容

---

## Acceptance Criteria

- **Given** 当前 fork 存在历史治理定制和上游差异  
  **When** 完成合并  
  **Then** 项目可以基于上游主路径运行，同时本地差异显著收敛。

- **Given** 团队项目通过 Trellis 使用自定义 spec/source  
  **When** 执行 `trellis init`  
  **Then** 团队约束能够通过官方 custom source 主路径进入项目，而非依赖旧的平行治理注入机制。

- **Given** 当前仍需的企业内部能力（如 Codeup source 支持）  
  **When** 合并完成  
  **Then** 这些能力仍可使用，且实现边界清晰、最小化。

- **指标**（KPI/SLI/SLO）：
  - fork 与 upstream 的差异面减少
  - 旧的治理专用链路不再是主路径
  - `init + custom spec/source` 主链可用
  - 本地必要能力无回退

---

## Definition of Done

- [ ] 完成 upstream 与 fork 差异梳理
- [ ] 完成上游合并或等效择取
- [ ] 完成必要冲突处理
- [ ] 明确列出保留的最小本地差异
- [ ] 构建与关键主路径验证通过
- [ ] 文档更新完成

---

## Risks & Edge Cases

- **风险点**：
  - 上游结构变化导致本地 patch 难以直接套用
  - 删除旧治理链路后，部分历史使用方式失效
  - `Codeup` source/provider 适配与 upstream registry 机制产生冲突
- **边界情况**：
  - 官方能力已覆盖部分本地改动，但接口不完全一致
  - 某些历史文档仍假设旧治理链路存在
  - 私有 npm 包名与发布配置需要持续兼容
- **降级方案**：
  - 先以最小可运行合并为目标，保留必要兼容层
  - 对不确定的差异点先做保守保留，再逐步清理
  - 先验证 `init + custom spec/source` 主路径，再继续去除冗余改动

---

## References

- **语雀文档**：暂无本地缓存
- **相关 Issue**：待补充
- **仓库/模块**：
  - `Trellis`
  - upstream `mindfold-ai/Trellis`
  - `ai-governance-and-skills-starter/ai-governance`

---

## Current Saved Progress (2026-04-17)

### Scope Decision
- 当前范围已收紧：**不要大面积修改官方内容**。
- 目标改为：仅在 `session-start` 注入层追加**递归加载第三方嵌套 spec** 的能力，同时保持官方顶层 `frontend/backend/guides` 结构与主文案不变。

### Saved Commit
- 已保存提交：`f29d196`
- Commit message：`feat: recursively load nested spec files at session start`

### Files Changed In Saved Commit
- `src/templates/claude/hooks/session-start.py`
- `src/templates/iflow/hooks/session-start.py`
- `src/templates/opencode/plugin/session-start.js`

### Behavior Added
- 递归读取 `.trellis/spec/` 下的 `.md` 文件
- 顶层分组顺序优先：`frontend` → `backend` → `guides` → 其他目录按字典序
- 同目录内 `index.md` 优先，其余 markdown 按文件名字典序
- 子目录递归按字典序
- 跳过隐藏文件和隐藏目录
- 超限时截断，并追加提示

### Guardrails
- `MAX_SPEC_FILES = 40`
- `MAX_SPEC_CHARS = 24_000`

### Explicitly Not Included
- 不包含更大范围的 upstream 收敛工作
- 不包含 `start/before/check` 模板文案修改
- 不包含 `src/commands/init.ts` 修改
- 不包含 `src/utils/template-fetcher.ts` 修改

### Recommended Next Step For Codex
1. 先读 `git show f29d196`
2. 再读上述 3 个文件，确认递归顺序和截断规则
3. 如继续开发，保持范围只在 `session-start` 注入层

### Additional Progress (2026-04-17)
- 已新增回归测试：`test/templates/session-start-context.test.ts`
- 覆盖范围：
  - Claude / iFlow hook 的嵌套 spec 递归加载顺序
  - 隐藏文件与隐藏目录跳过
  - Claude hook 的 `MAX_SPEC_FILES = 40` 截断提示
  - OpenCode plugin 首条用户消息前置注入的递归 spec 行为
- 当前建议：
  - 继续以验证和小范围补强为主
  - 不扩大到 `init` / `template-fetcher` / 文案体系调整
