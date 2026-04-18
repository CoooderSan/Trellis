# Team Governance Preflight 与 Team-First Start 流程

## Goal

让 `Trellis` 在任何开发任务启动时，先基于 `ecochain` 团队约束完成一次 **Team Governance Preflight**，再进入自身的 `brainstorm / task / PRD / implement` 流程；同时将团队治理 spec 真源收敛为 `spec/ecochain/**` 多层命名空间结构。

---

## Background

- **现状与问题**：
  - 当前 `Trellis` 已支持在会话启动时递归注入 `.trellis/spec/**/*.md`，但 `start` 流程仍然主要按 Trellis 自身通用步骤推进：读取上下文 → 分类任务 → brainstorm / create task / 写 PRD。
  - 这意味着即使团队规则已被注入，AI 仍可能先进入 Trellis 的默认流程，之后才补查团队门禁，导致顺序颠倒。
  - 当前 `ai-governance` 中的治理 spec 真源仍主要落在：
    - `spec/governance/*`
    - `spec/testing/*`
  - 当通过 `trellis init --registry <.../spec>` 安装时，这些目录会被直接铺到 `.trellis/spec/` 下，最终形成：
    - `.trellis/spec/governance/*`
    - `.trellis/spec/testing/*`
  - 这与预期的团队命名空间结构不一致，也不利于明确表达“先团队、后 Trellis”的执行优先级。
- **为什么需要这个功能**：
  - 团队治理约束不仅包含 `intent`，还包括分支规则、PR 规则、测试门禁、系统归属、角色职责等。
  - `Trellis` 应作为通用执行框架，而不是高于团队治理的默认主流程。
  - 需要把“先看团队约束，再执行 Trellis”的顺序固化为显式流程，而不是依赖模型自行领会。
- **系统/模块**：
  - `Trellis`
  - `ai-governance-and-skills-starter/ai-governance`
  - `.trellis/spec/**/*.md`
  - `/trellis:start`、对应平台的 start 模板与相关 brainstorm / task workflow
- **目标用户 / 业务角色**：
  - 使用 Trellis 进行日常开发的 `ecochain` 团队成员
  - 需要遵守团队研发流程的 Claude / Codex / iFlow / OpenCode 用户
- **影响的业务对象 / 范围**：
  - 开发任务启动流程
  - 团队治理 spec 目录结构
  - 任务创建、PRD 建立、需求澄清、实现前门禁

---

## Requirements

### 功能需求
- [ ] 将团队治理 spec 真源重构为 `spec/ecochain/**` 多层命名空间结构，而不是继续平铺在 `spec/governance/*` 与 `spec/testing/*`。
- [ ] 至少提供如下第一版团队治理目录：
  - `spec/ecochain/common/start-session.md`
  - `spec/ecochain/common/intent-gate.md`
  - `spec/ecochain/common/system-boundary.md`
  - `spec/ecochain/develop/branch-governance.md`
  - `spec/ecochain/develop/pr-governance.md`
  - `spec/ecochain/develop/code-governance.md`
  - `spec/ecochain/testing/test-entry-gate.md`
  - `spec/ecochain/testing/workflow.md`
- [ ] `common/start-session.md` 必须作为团队启动治理总入口，明确说明：启动开发任务时，AI 必须先识别并归纳本次任务适用的团队规则，再决定是否进入 Trellis 默认流程。
- [ ] `Trellis` 的 `start` 模板（至少覆盖 Claude / iFlow / Codex / OpenCode 对应实现）必须新增 **Team Governance Preflight** 步骤，位置在：
  - `get_context` 之后
  - task classification / brainstorm / task create 之前
- [ ] `Trellis start` 模板改造只负责：
  - 读取团队入口规则
  - 产出适用规则摘要
  - 执行是否放行到后续流程的判定
  - 在阻塞时停止继续推进
- [ ] `Trellis start` 模板改造不负责：
  - 自动创建分支
  - 自动创建 PR / MR
  - 自动生成 intent 正文
  - 自动补齐所有治理文档内容
- [ ] Team Governance Preflight 的结果必须在对话中显式展示给用户，而不是仅作为内部隐式判断。
- [ ] Team Governance Preflight 至少要显式处理以下团队约束：
  - 是否必须先有 `intent`
  - 任务归属系统 / 边界是否已明确（如 WMS / WES / 协同）
  - 分支规则是否已满足
  - PR 规则是否需要提前记录（例如是否必须附 `intent / PRD` 链接）
  - 测试规则是否要求先进行测试设计、测试说明或测试门禁判断
  - 如适用，角色职责与协作边界是否已明确
- [ ] 当 Team Governance Preflight 发现硬性前置条件未满足时，必须停止后续 Trellis 步骤，并先向用户说明缺失项；此时不得：
  - 创建 task 目录
  - 写 `prd.md`
  - 进入实现阶段
- [ ] 只有在 Team Governance Preflight 完成并确认可继续后，才允许进入：
  - 任务分类
  - brainstorm
  - task workflow
  - research / implementation / check
- [ ] 最终对外行为必须体现：**团队治理是上层策略，Trellis 是下层执行器。**
- [ ] 继续复用 `.trellis/spec/**/*.md` 的递归注入能力，不新增第二套 prompt 注入器，不恢复旧 governance bootstrap 直注入路径。

### 非功能需求
- **一致性**：
  - Claude / Codex / iFlow / OpenCode 的 `start` 体验在团队治理前置上保持一致口径。
- **可维护性**：
  - 团队启动规则通过 `common/start-session.md` 集中表达，避免把前置规则散落在多个模板里各写一遍。
- **可理解性**：
  - 用户在执行 `/trellis:start` 后，能够看到一份清晰的“本次任务适用团队规则清单”，而不是让 AI 隐式地自己判断。
- **兼容性**：
  - 不影响 Trellis 现有递归读取 `.trellis/spec/**/*.md` 的实现。
  - 不依赖新的私有运行时注入机制。
- **边界清晰**：
  - 团队规则负责定义“能不能开始、开始前要满足什么”；
  - Trellis 负责在满足前置条件后执行标准任务流。

---

## Out of Scope

明确不做什么：
- 不在本任务中重新设计所有团队业务规则的具体正文。
- 不在本任务中重做 skills marketplace / bundle / local sync 分发体系。
- 不在本任务中实现 PR 自动创建、分支自动创建等具体自动化能力。
- 不在本任务中引入新的 prompt bootstrap 或隐藏式 runtime 注入链路。
- 不要求本任务一次性覆盖所有未来团队目录，只要求先把 `ecochain/common|develop|testing` 主干打通。

---

## Technical Design (Optional)

- **技术方案选择**：
  - 将团队治理真源重构为 `spec/ecochain/**`。
  - 以 `spec/ecochain/common/start-session.md` 作为团队启动治理唯一入口。
  - 在 `Trellis` 的 `start` 模板中显式插入 Team Governance Preflight 步骤。
- **关键实现细节**：
  - `trellis init --registry <.../spec>` 下载安装后，目录应呈现为：
    - `.trellis/spec/ecochain/common/*`
    - `.trellis/spec/ecochain/develop/*`
    - `.trellis/spec/ecochain/testing/*`
  - `start` 模板建议改为如下顺序：
    1. 读取 `workflow.md`
    2. 执行 `get_context.py`
    3. 说明 `.trellis/spec/**/*.md` 已注入
    4. 执行 **Team Governance Preflight**：
       - 优先检查 `ecochain/common/start-session.md`
       - 提炼本次任务适用的团队规则
       - 判断是否缺失硬性前置条件
       - 若缺失，则先停在治理补齐阶段
    5. 只有通过 preflight 后，才进入 task classification / brainstorm / task workflow
  - Team Governance Preflight 的输出应至少包括：
    - 本次任务类型判断
    - 适用的团队规则文件集合
    - 已满足项
    - 缺失项 / 阻塞项
    - 下一步允许执行的动作
  - `brainstorm` 与后续 task workflow 应继承 preflight 的结论，而不是重新绕过团队规则直接推进。
- **依赖与集成**：
  - 依赖 Trellis 已有的递归 spec 注入能力
  - 依赖 `ai-governance` 中团队治理 spec 的结构化重排
  - 与现有 `.trellis/spec/**/*.md` 自定义源安装能力保持兼容

---

## Proposed Team Governance Layout (V1)

### 目录结构

```text
spec/
  ecochain/
    common/
      start-session.md
      intent-gate.md
      system-boundary.md
      role-boundary.md
    develop/
      branch-governance.md
      pr-governance.md
      code-governance.md
      pr-checklist.md
    testing/
      test-entry-gate.md
      workflow.md
      layering.md
      promotion.md
```

### 分层职责

- `ecochain/common/`
  - 负责所有开发任务启动前都可能适用的团队总规则
  - 明确哪些是启动前硬性 gate，哪些是后续执行期持续遵守的规则
- `ecochain/develop/`
  - 负责开发过程中的分支、PR、代码规范、提交流程等规则
  - 由 preflight 在“本次任务是开发任务”时纳入适用规则集
- `ecochain/testing/`
  - 负责测试设计、测试准入、测试分层、测试升级路径等规则
  - 由 preflight 在任务涉及测试或需要质量门禁时纳入适用规则集

### 文件职责建议

- `common/start-session.md`
  - 团队启动总入口
  - 指定 preflight 的必读文件与判定顺序
  - 规定“未通过 preflight 不得进入 Trellis 默认开发流程”
- `common/intent-gate.md`
  - 定义哪些任务必须先有 intent
  - 定义哪些任务不属于 intent 开发任务
- `common/system-boundary.md`
  - 定义系统归属判定规则，例如 WMS / WES / 协同
- `common/role-boundary.md`
  - 定义产品、开发、测试、AI 协作时的角色边界
- `develop/branch-governance.md`
  - 分支命名、分支来源、禁止直接在错误分支上开发等规则
- `develop/pr-governance.md`
  - PR/MR 提交要求、是否必须附 intent/PRD 链接、描述结构要求
- `develop/code-governance.md`
  - 开发期代码规范、实现边界、注释/测试/变更策略等规则
- `develop/pr-checklist.md`
  - PR 前自检项，供 preflight 或后续检查阶段引用
- `testing/test-entry-gate.md`
  - 什么情况下必须先做测试设计 / 测试说明 / 风险分层
- `testing/workflow.md`
  - 测试整体工作流
- `testing/layering.md`
  - 测试分层策略
- `testing/promotion.md`
  - 测试升级、阻塞与放行条件

---

## Proposed Preflight Behavior (V1)

### Team Governance Preflight 顺序

`/trellis:start` 在进入 Trellis 自身 task workflow 前，必须按如下顺序执行：

1. 读取 `.trellis/spec/ecochain/common/start-session.md`
2. 判定当前请求是否属于：
   - 纯问答 / 说明 / 运维
   - 开发任务
   - 开发 + 测试联动任务
3. 根据任务类型构建本次适用规则集：
   - 始终包含：`common/*`
   - 开发任务追加：`develop/*`
   - 涉及测试时追加：`testing/*`
4. 输出本次任务适用规则摘要：
   - 硬性 gate
   - 提示性规则
   - 当前已满足项
   - 当前缺失项
5. 如果存在未满足的硬性 gate，则停止在 preflight
6. 只有在硬性 gate 满足后，才允许进入 Trellis 的 classify / brainstorm / create task / PRD / implement

### 硬性 gate 与提示性规则边界

#### 硬性 gate（阻塞后续流程）
- 是否属于必须先有 `intent` 的任务
- 是否已明确系统归属 / 业务边界
- 是否已满足必须先确定的分支策略
- 是否已满足必须先明确的测试准入条件
- 是否缺少会直接影响实现方向的关键前置资料

#### 提示性规则（不阻塞，但必须纳入后续执行）
- PR 描述格式建议
- PR 中附带的链接清单
- 分支清理建议
- 测试报告模板与分析模板
- 团队协作中的推荐动作，但非启动前硬门禁

### 阻塞时的预期行为

若 preflight 未通过，`/trellis:start` 应：
- 明确说明是哪个团队规则阻塞了继续执行
- 说明为什么当前不能直接创建 task / 写 PRD / 开始 brainstorm
- 给出下一步最小动作，例如：
  - 先补 intent
  - 先确认系统归属
  - 先确认分支策略
  - 先确认是否需要测试设计

### 通过时的预期行为

若 preflight 通过，`/trellis:start` 应：
- 先给出“本次任务适用规则清单”摘要
- 再进入 Trellis 的任务分类与后续流程
- 在后续 brainstorm / task / PRD 过程中保持这些团队规则为上层约束

---

## Migration Mapping (Draft)

### 当前目录到目标目录的映射建议

- `spec/governance/intent-gate.md`
  → `spec/ecochain/common/intent-gate.md`
- `spec/governance/access-control.md`
  → 保留在团队公共规则中，后续视语义决定是否进入 `common/` 的独立文件
- `spec/governance/execution-protocol.md`
  → 拆分后并入 `common/start-session.md` 与 `develop/code-governance.md`
- `spec/governance/code-governance.md`
  → `spec/ecochain/develop/code-governance.md`
- `spec/governance/pr-governance.md`
  → `spec/ecochain/develop/pr-governance.md`
- `spec/governance/skill-installation.md`
  → 不作为 team-first start 的主 gate，可保留为运维类文档
- `spec/governance/skill-surface.md`
  → 不作为 start preflight 主文档，可保留为能力说明
- `spec/testing/workflow.md`
  → `spec/ecochain/testing/workflow.md`
- `spec/testing/layering.md`
  → `spec/ecochain/testing/layering.md`
- `spec/testing/promotion.md`
  → `spec/ecochain/testing/promotion.md`

### 迁移原则

- 先做语义重组，再做文件移动，避免“文件位置变了但规则职责没收口”。
- `common/start-session.md` 只保留团队启动治理所必需的规则摘要与引用，不把所有长篇细则都堆进去。
- 旧路径可在迁移期保留映射说明，但不应长期双写为两个真源。

---

## Acceptance Criteria

- **Given** 团队通过 custom source 安装 `ai-governance/spec`  
  **When** 安装完成  
  **Then** 本地目录呈现为 `.trellis/spec/ecochain/**`，而不是只有平铺的 `governance/*` 与 `testing/*`。

- **Given** 用户在团队项目中执行 `/trellis:start` 并描述一个开发任务  
  **When** start 流程开始推进  
  **Then** AI 会先输出本次任务适用的团队治理规则与阻塞项，再决定是否进入 brainstorm / task create / 写 PRD。

- **Given** 当前任务按团队规则要求必须先有 `intent`  
  **When** 用户尚未提供或确认 `intent`  
  **Then** AI 不会先创建 task 目录或 `prd.md`，而是先停在团队治理补齐阶段。

- **Given** 当前任务涉及分支、PR、测试、系统边界等团队约束  
  **When** Team Governance Preflight 完成  
  **Then** 这些规则会被显式纳入当前任务可执行范围说明，而不是由 Trellis 默认流程隐式跳过。

- **Given** 团队治理规则已经满足  
  **When** 用户继续推进任务  
  **Then** Trellis 才进入标准的 brainstorm / task / PRD / research / implement / check 流程。

- **指标**（KPI/SLI/SLO，如适用）：
  - `/trellis:start` 首轮响应中明确包含团队治理 preflight 结果
  - 对必须先有 `intent` 的任务，不再出现“先建 task / 后补查 intent”的顺序错误
  - 团队治理目录结构统一收口到 `spec/ecochain/**`
  - 不新增第二条治理注入主路径

---

## Definition of Done

- [ ] 明确 `spec/ecochain/common|develop|testing` 第一版目录与职责边界
- [ ] 明确 `common/start-session.md` 的入口职责与引用关系
- [ ] 明确 `Trellis start` 模板中 Team Governance Preflight 的插入位置与行为
- [ ] 明确哪些团队规则属于硬性 gate，哪些属于提示性规则
- [ ] 明确 `/trellis:start` 成功与阻塞两种路径下的预期对话行为
- [ ] 明确本次改造不引入第二套 runtime prompt 注入路径

---

## Risks & Edge Cases

- **风险点**：
  - 若只改 spec 目录、不改 `start` 流程，团队规则仍可能“看得到但不先执行”。
  - 若只改 `start` 流程、不改 spec 真源结构，团队规则入口仍然不清晰，后续扩展容易继续平铺失控。
  - 若把过多细节直接硬编码进 Trellis 模板，后续团队规则调整成本会重新升高。
- **边界情况**：
  - 某些任务是纯问答、排查或运维，不一定需要 `intent`，但仍可能需要适用其他团队规则。
  - 同一任务可能同时命中 `common + develop + testing` 多组团队约束。
  - 不同平台（Claude / Codex / iFlow / OpenCode）需避免出现前置规则口径不一致。
- **异常流 / 失败场景**：
  - 若团队入口文件缺失或结构不完整，`start` 需要明确报告团队治理 preflight 不完整，而不是静默降级为 Trellis 默认流程。
  - 若用户提供的需求过于模糊，preflight 需要先澄清系统归属或任务类型，再决定后续路径。
- **回滚 / 降级约束**：
  - 即使团队治理 preflight 尚未完全实现，也不能重新启用旧 governance bootstrap prompt 注入作为补丁。
  - 如需分阶段落地，应优先保证“先团队、后 Trellis”的顺序明确可见，再补细节规则覆盖。

---

## Release / Rollback Notes

- **是否需要灰度 / 分批发布**：
  - 建议先在 `ecochain` 团队 spec 与本地 Trellis fork 中验证，再推广给更多团队。
- **是否有发布时间窗口**：
  - 无强依赖窗口，但建议与团队当前开发节奏错峰，避免中途切换 start 习惯造成混乱。
- **失败后的回退方式**：
  - 可临时回退 `start` 模板改动，但不应回退到旧 bootstrap prompt 注入链路。
  - spec 结构迁移应在保留旧文档映射说明的前提下分阶段进行，避免团队入口一次性丢失。

---

## References

- **Intent / PRD**：
  - `docs/intents/20260416-trellis-upstream-merge.md`
  - `docs/intents/20260417-governance-spec-convergence.md`
- **设计文档**：待补充
- **Work Item / Issue**：待补充
- **语雀 / 现有资料**：当前会话未引用本地语雀缓存
- **相关仓库 / 模块**：
  - `Trellis`
  - `ai-governance-and-skills-starter/ai-governance`
  - `src/templates/claude/commands/trellis/start.md`
  - `src/templates/iflow/commands/trellis/start.md`
  - `src/templates/codex/skills/start/SKILL.md`
  - `src/templates/opencode/commands/trellis/start.md`
