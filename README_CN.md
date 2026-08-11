<p align="center">
<picture>
<source srcset="assets/trellis.png" media="(prefers-color-scheme: dark)">
<source srcset="assets/trellis.png" media="(prefers-color-scheme: light)">
<img src="assets/trellis.png" alt="Trellis Logo" width="500" style="image-rendering: -webkit-optimize-contrast; image-rendering: crisp-edges;">
</picture>
</p>

<p align="center">
<strong>开箱即用的 AI 编码工程化框架</strong><br/>
<sub>AI 写代码很快，但它每次会话都从零开始理解项目，记不住你的规范，也记不住团队级别的需求。Trellis 会把规范、任务、记忆沉淀进仓库，让任意 Coding Agent 都按你的工程标准来实践。</sub>
</p>

<p align="center">
<a href="./README.md">English</a> •
<a href="#快速开始">Ecochain 快速开始</a> •
<a href="https://docs.trytrellis.app/zh">上游文档</a> •
<a href="https://docs.trytrellis.app/zh/advanced/multi-platform">支持平台</a> •
<a href="https://docs.trytrellis.app/zh/start/real-world-scenarios">使用场景</a>
</p>

<p align="center">
<a href="https://github.com/mindfold-ai/Trellis/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-16a34a.svg?style=flat-square" alt="license" /></a>
<a href="https://github.com/mindfold-ai/Trellis/stargazers"><img src="https://img.shields.io/github/stars/mindfold-ai/Trellis?style=flat-square&color=eab308" alt="stars" /></a>
<a href="https://docs.trytrellis.app/zh"><img src="https://img.shields.io/badge/docs-upstream_reference-0f766e?style=flat-square" alt="上游文档" /></a>
<a href="https://discord.com/invite/tWcCZ3aRHc"><img src="https://img.shields.io/badge/Discord-Join-5865F2?style=flat-square&logo=discord&logoColor=white" alt="Discord" /></a>
<a href="https://github.com/mindfold-ai/Trellis/issues"><img src="https://img.shields.io/github/issues/mindfold-ai/Trellis?style=flat-square&color=e67e22" alt="open issues" /></a>
<a href="https://github.com/mindfold-ai/Trellis/pulls"><img src="https://img.shields.io/github/issues-pr/mindfold-ai/Trellis?style=flat-square&color=9b59b6" alt="open PRs" /></a>
<a href="https://deepwiki.com/mindfold-ai/Trellis"><img src="https://img.shields.io/badge/Ask-DeepWiki-blue?style=flat-square" alt="Ask DeepWiki" /></a>
<a href="https://chatgpt.com/?q=Explain+the+project+mindfold-ai/Trellis+on+GitHub"><img src="https://img.shields.io/badge/Ask-ChatGPT-74aa9c?style=flat-square&logo=openai&logoColor=white" alt="Ask ChatGPT" /></a>
</p>

<p align="center">
<img src="assets/trellis-demo-zh.gif" alt="Trellis 工作流演示" width="100%">
</p>

## 为什么用 Trellis？

| 能力               | 带来的改变                                                                                                  |
| ------------------ | ----------------------------------------------------------------------------------------------------------- |
| **自动注入规范**   | 将规范沉淀到 `.trellis/spec/` 之后，Trellis 会在每次会话中按当前任务自动按需注入相关上下文，无需反复说明。  |
| **任务驱动工作流** | PRD、实现上下文、审查上下文与任务状态统一存放于 `.trellis/tasks/`，AI 开发过程保持结构化、可追溯。          |
| **项目记忆**       | `.trellis/workspace/` 中的工作日志（journal）会保留上一次会话的脉络，因此每次新会话都能基于真实上下文开始。 |
| **团队共享标准**   | Spec 随仓库一同版本化，个人总结出的规则与流程可以直接成为整个团队的基础设施。                               |
| **多平台复用**     | 同一套 Trellis 结构覆盖 21 个 AI coding 平台，无需为每个工具单独搭建工作流。                                |

## 前置要求

- **Node.js** >= 18
- **Python** >= 3.9

## 快速开始

```bash
# 1. 安装 Trellis
npm install -g @ecochain/trellis@latest

# 2. 在仓库中初始化
trellis init -u your-name

# 3. 或仅初始化你实际使用的平台
trellis init --cursor --opencode --codex -u your-name
```

以上命令是本 Ecochain fork 的权威安装方式。[上游文档](https://docs.trytrellis.app/zh)
仍可用于查询功能和平台能力，但其中的安装示例使用上游 `@mindfoldhq` 包，
不是本仓库发布的 Ecochain 包。

## 如何使用

自然语言是正常的工作流入口：

1. **用自然语言描述你的需求。**
2. **由 Agent 对请求分类** —— readonly、operational、business feature、bugfix、maintenance 或 review revision，并仅按范围和风险创建必要的 task 工件。
3. **在需要时确认门禁和证据。**业务 feature 必须提供 Product Intent；maintenance 与 bugfix 可在 Task Basis 中说明理由并标记 `NOT_REQUIRED`。验证方式根据风险和适用性选择。
4. **按照当前 workflow 与宿主能力完成收尾。**显式 Trellis Command/Skill 用于恢复、纠偏、高级控制，或作为平台无法自动路由时的 fallback，并非必须手工执行的命令链。

## 工作原理

Trellis 根据当前 workflow 和 task 状态路由请求。Readonly 与普通 operational
工作通常无需开发 task；开发工作按比例记录 Task Basis，并在需要时补充 PRD、
design 或 implement 计划，然后执行适用的验证与收尾步骤。

执行既可以采用 **inline 模式**，由当前 Agent 直接读取 task 与适用的
`.trellis/spec/`；也可以将边界清晰的工作交给 **sub-agent**。只有 sub-agent
派发依赖经过筛选的 `implement.jsonl` 或 `check.jsonl`；这些文件是上下文
manifest，不是实现日志或质量结果。Inline 模式不要求 JSONL，但仍必须加载
适用 Spec 并执行验证。

## 资源

| 需求                 | 链接                                                                  |
| -------------------- | --------------------------------------------------------------------- |
| 安装 Ecochain fork   | [Ecochain 快速开始](#快速开始)                                        |
| 了解各平台之间的差异 | [支持平台](https://docs.trytrellis.app/zh/advanced/multi-platform)    |
| 查看实际使用场景     | [真实场景](https://docs.trytrellis.app/zh/start/real-world-scenarios) |
| 从 Spec 模板起步     | [Spec 模板](https://docs.trytrellis.app/zh/templates/specs-index)     |
| 跟进版本更新         | [更新日志](https://docs.trytrellis.app/zh/changelog)                  |

## 常见问题

<details>
<summary><strong>Trellis 与 <code>CLAUDE.md</code>、<code>AGENTS.md</code>、<code>.cursorrules</code> 有何区别？</strong></summary>

这些文件本身是有用的入口，但容易在长期使用中变得冗长臃肿。Trellis 在此之上补充了：作用域明确的 Spec、按任务划分的 PRD、工作流关卡、工作区记忆，以及按平台自动生成的适配文件。

</details>

<details>
<summary><strong>Trellis 是否仅支持 Claude Code？</strong></summary>

并非如此。Trellis 是项目层基础设施，可在多种 coding agent 与 IDE 中使用。

</details>

<details>
<summary><strong>Trellis 适合个人开发者还是团队？</strong></summary>

两者皆可。个人开发者主要受益于记忆机制与可复用的工作流；团队使用收益更大——标准统一、任务边界清晰、上下文可审查，且具备跨平台可移植性。

</details>

<details>
<summary><strong>是否需要手动编写每一个 Spec 文件？</strong></summary>

并不需要。多数团队的做法是先由 AI 基于现有代码生成初稿，再人工收紧关键规则。Trellis 的效果取决于是否将高价值规则显式化并纳入版本管理。

</details>

<details>
<summary><strong>团队协作时是否会频繁产生冲突？</strong></summary>

不会。个人工作区的 journal 按开发者独立维护，共享的 Spec 与任务则进入仓库，可以像其他项目产物一样进行评审与改进。

</details>

## Star 历史

[![Star History Chart](https://api.star-history.com/svg?repos=mindfold-ai/Trellis&type=Date)](https://star-history.com/#mindfold-ai/Trellis&Date)

## 社区与资源

- [上游功能文档](https://docs.trytrellis.app/zh)
- [GitHub Issues](https://github.com/mindfold-ai/Trellis/issues)
- [Discord](https://discord.com/invite/tWcCZ3aRHc)
- [技术博客](https://docs.trytrellis.app/zh/blog)

### 联系我们

<p align="center">
<img src="assets/wx_link11.jpg" alt="微信群" width="260" />
&nbsp;&nbsp;&nbsp;&nbsp;
<img src="assets/feishu-group-qr.jpg" alt="飞书话题群" width="260" />
</p>

<p align="center">
<a href="https://github.com/mindfold-ai/Trellis">官方仓库</a> •
<a href="https://github.com/mindfold-ai/Trellis/blob/main/LICENSE">AGPL-3.0 License</a> •
由 <a href="https://github.com/mindfold-ai">Mindfold</a> 构建
</p>
