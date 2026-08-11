<p align="center">
<picture>
<source srcset="assets/trellis.png" media="(prefers-color-scheme: dark)">
<source srcset="assets/trellis.png" media="(prefers-color-scheme: light)">
<img src="assets/trellis.png" alt="Trellis Logo" width="500" style="image-rendering: -webkit-optimize-contrast; image-rendering: crisp-edges;">
</picture>
</p>

<p align="center">
<strong>An out-of-the-box engineering framework for AI coding.</strong><br/>
<sub>AI writes code fast, but every session it starts from scratch — no memory of your project, your conventions, or your team's requirements. Trellis persists specs, tasks, and memory into your repo, so any coding agent works to your engineering standards.</sub>
</p>

<p align="center">
<a href="./README_CN.md">简体中文</a> •
<a href="#quick-start">Ecochain Quick Start</a> •
<a href="https://docs.trytrellis.app/">Upstream Docs</a> •
<a href="https://docs.trytrellis.app/advanced/multi-platform">Supported Platforms</a> •
<a href="https://docs.trytrellis.app/start/real-world-scenarios">Use Cases</a>
</p>

<p align="center">
<a href="https://github.com/mindfold-ai/Trellis/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-16a34a.svg?style=flat-square" alt="license" /></a>
<a href="https://github.com/mindfold-ai/Trellis/stargazers"><img src="https://img.shields.io/github/stars/mindfold-ai/Trellis?style=flat-square&color=eab308" alt="stars" /></a>
<a href="https://docs.trytrellis.app/"><img src="https://img.shields.io/badge/docs-upstream_reference-0f766e?style=flat-square" alt="upstream docs" /></a>
<a href="https://discord.com/invite/tWcCZ3aRHc"><img src="https://img.shields.io/badge/Discord-Join-5865F2?style=flat-square&logo=discord&logoColor=white" alt="Discord" /></a>
<a href="https://github.com/mindfold-ai/Trellis/issues"><img src="https://img.shields.io/github/issues/mindfold-ai/Trellis?style=flat-square&color=e67e22" alt="open issues" /></a>
<a href="https://github.com/mindfold-ai/Trellis/pulls"><img src="https://img.shields.io/github/issues-pr/mindfold-ai/Trellis?style=flat-square&color=9b59b6" alt="open PRs" /></a>
<a href="https://deepwiki.com/mindfold-ai/Trellis"><img src="https://img.shields.io/badge/Ask-DeepWiki-blue?style=flat-square" alt="Ask DeepWiki" /></a>
<a href="https://chatgpt.com/?q=Explain+the+project+mindfold-ai/Trellis+on+GitHub"><img src="https://img.shields.io/badge/Ask-ChatGPT-74aa9c?style=flat-square&logo=openai&logoColor=white" alt="Ask ChatGPT" /></a>
</p>

<p align="center">
<img src="assets/trellis-demo.gif" alt="Trellis workflow demo" width="100%">
</p>

## Why Trellis?

| Capability                 | What it changes                                                                                                                           |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **Auto-injected specs**    | Write conventions once in `.trellis/spec/`, then let Trellis inject the relevant context into each session instead of repeating yourself. |
| **Task-centered workflow** | Keep PRDs, implementation context, review context, and task status in `.trellis/tasks/` so AI work stays structured.                      |
| **Project memory**         | Journals in `.trellis/workspace/` preserve what happened last time, so each new session starts with real context.                         |
| **Team-shared standards**  | Specs live in the repo, so one person's hard-won workflow or rule can benefit the whole team.                                             |
| **Multi-platform setup**   | Bring the same Trellis structure to 21 AI coding platforms instead of rebuilding your workflow per tool.                                  |

## Prerequisites:

- **Node.js** >= 18
- **Python** >= 3.9

## Quick Start

```bash
# 1. Install Trellis
npm install -g @ecochain/trellis@latest

# 2. Initialize in your repo
trellis init -u your-name

# 3. Or initialize with the platforms you actually use
trellis init --cursor --opencode --codex -u your-name
```

The commands above are the authoritative installation path for this Ecochain fork. The
[upstream documentation](https://docs.trytrellis.app/) remains useful for feature and
platform reference, but its installation examples use the upstream `@mindfoldhq`
packages rather than the Ecochain packages published here.

## How to Use

Natural language is the normal workflow entry:

1. **Describe what you want** in natural language.
2. **Let the agent classify the request** as readonly, operational, business feature, bugfix, maintenance, or review revision. It creates only the task artifacts justified by the request's scope and risk.
3. **Review gates and evidence when requested.** Product Intent is required for business features; maintenance and bugfix work may use a reasoned `NOT_REQUIRED` Task Basis. Verification is selected according to risk and applicability.
4. **Complete through the active workflow and host.** Explicit Trellis commands and skills remain available for recovery, correction, advanced control, or platforms without automatic routing; they are not a required command chain.

## How It Works

Trellis routes each request through the current workflow and task state. Readonly and
ordinary operational work normally proceeds without a development task. Development
work records a proportionate Task Basis and, when needed, a PRD, design, or
implementation plan before applicable verification and completion steps run.

Execution can stay **inline**, where the active agent reads the task and applicable
`.trellis/spec/` files directly, or use **sub-agents** for bounded work. Sub-agent
dispatch requires curated `implement.jsonl` or `check.jsonl` context; those files are
context manifests, not implementation logs or quality results. Inline execution does
not require JSONL, but it still loads the relevant specs and performs verification.

## Resources

| Need                            | Link                                                                           |
| ------------------------------- | ------------------------------------------------------------------------------ |
| Install the Ecochain fork       | [Ecochain Quick Start](#quick-start)                                           |
| Understand platform differences | [Supported Platforms](https://docs.trytrellis.app/advanced/multi-platform)     |
| See the workflow in practice    | [Real-World Scenarios](https://docs.trytrellis.app/start/real-world-scenarios) |
| Start from spec templates       | [Spec Templates](https://docs.trytrellis.app/templates/specs-index)            |
| Track releases                  | [Changelog](https://docs.trytrellis.app/changelog)                             |

## FAQ

<details>
<summary><strong>How is Trellis different from <code>CLAUDE.md</code>, <code>AGENTS.md</code>, or <code>.cursorrules</code>?</strong></summary>

Those files are useful entry points, but they tend to become monolithic. Trellis adds scoped specs, task PRDs, workflow gates, workspace memory, and platform-aware generated files around them.

</details>

<details>
<summary><strong>Is Trellis only for Claude Code?</strong></summary>

No. Trellis is a project layer that works across multiple coding agents and IDEs.

</details>

<details>
<summary><strong>Is Trellis for solo developers or teams?</strong></summary>

Both. Solo developers use it for memory and repeatable workflow. Teams get the larger benefit: shared standards, task boundaries, reviewable context, and platform portability.

</details>

<details>
<summary><strong>Do I have to write every spec file manually?</strong></summary>

No. Many teams start by letting AI draft specs from existing code and then tighten the important parts by hand. Trellis works best when you keep the high-signal rules explicit and versioned.

</details>

<details>
<summary><strong>Can teams use this without constant conflicts?</strong></summary>

Yes. Personal workspace journals stay separate per developer, while shared specs and tasks stay in the repo where they can be reviewed and improved like any other project artifact.

</details>

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=mindfold-ai/Trellis&type=Date)](https://star-history.com/#mindfold-ai/Trellis&Date)

## Community & Resources

- [Upstream feature documentation](https://docs.trytrellis.app/)
- [GitHub Issues](https://github.com/mindfold-ai/Trellis/issues)
- [Discord](https://discord.com/invite/tWcCZ3aRHc)
- [Tech Blog](https://docs.trytrellis.app/blog)

<p align="center">
<a href="https://github.com/mindfold-ai/Trellis">Official Repository</a> •
<a href="https://github.com/mindfold-ai/Trellis/blob/main/LICENSE">AGPL-3.0 License</a> •
Built by <a href="https://github.com/mindfold-ai">Mindfold</a>
</p>
