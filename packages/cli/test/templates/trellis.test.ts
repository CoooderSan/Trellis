import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  collectPlatformTemplates,
  PLATFORM_IDS,
} from "../../src/configurators/index.js";
import type { AITool } from "../../src/types/ai-tools.js";
import {
  scriptsInit,
  commonInit,
  commonPaths,
  commonDeveloper,
  commonGitContext,
  commonTaskQueue,
  commonTaskUtils,
  commonActiveTask,
  commonCliAdapter,
  getDeveloperScript,
  initDeveloperScript,
  taskScript,
  getContextScript,
  addSessionScript,
  workflowMdTemplate,
  gitignoreTemplate,
  getAllScripts,
  getAllAgents,
  implementAgentTemplate,
  checkAgentTemplate,
  configYamlTemplate,
} from "../../src/templates/trellis/index.js";

// =============================================================================
// Template Constants — module-level string exports
// =============================================================================

describe("trellis template constants", () => {
  const allTemplates = {
    scriptsInit,
    commonInit,
    commonPaths,
    commonDeveloper,
    commonGitContext,
    commonTaskQueue,
    commonTaskUtils,
    commonActiveTask,
    commonCliAdapter,
    getDeveloperScript,
    initDeveloperScript,
    taskScript,
    getContextScript,
    addSessionScript,
    workflowMdTemplate,
    gitignoreTemplate,
  };

  function inProgressBreadcrumb(): string {
    const inProgressMatch =
      /\[workflow-state:in_progress\]([\s\S]*?)\[\/workflow-state:in_progress\]/.exec(
        workflowMdTemplate,
      );
    if (!inProgressMatch) {
      throw new Error("in_progress breadcrumb block must exist in workflow.md");
    }
    return inProgressMatch[1];
  }

  function workflowStateBreadcrumb(status: string): string {
    const match = new RegExp(
      `\\[workflow-state:${status}\\]([\\s\\S]*?)\\[/workflow-state:${status}\\]`,
    ).exec(workflowMdTemplate);
    if (!match) {
      throw new Error(`${status} breadcrumb block must exist in workflow.md`);
    }
    return match[1];
  }

  function stepSection(step: string): string {
    const pattern = new RegExp(
      `#### ${step.replace(".", "\\.")}[^\\n]*\\n([\\s\\S]*?)(?=\\n#### |\\n### |$)`,
    );
    const match = pattern.exec(workflowMdTemplate);
    if (!match) {
      throw new Error(`workflow.md step ${step} must exist`);
    }
    return match[1];
  }

  function platformBlock(section: string, openingMarker: string): string {
    const normalizedSection = section.replace(/\r\n/g, "\n");
    const escaped = openingMarker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const closingMarker = openingMarker.replace("[", "[/");
    const escapedClosing = closingMarker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`${escaped}\\n([\\s\\S]*?)\\n${escapedClosing}`);
    const match = pattern.exec(normalizedSection);
    if (!match) {
      throw new Error(`workflow.md block ${openingMarker} must exist`);
    }
    return match[0];
  }

  it("all templates are non-empty strings", () => {
    for (const [name, content] of Object.entries(allTemplates)) {
      expect(content.length, `${name} should be non-empty`).toBeGreaterThan(0);
    }
  });

  it("Python scripts contain valid Python syntax indicators", () => {
    // scriptsInit (__init__.py) only has docstrings, so use scripts with actual code
    const pyScripts = [
      commonInit,
      commonPaths,
      commonActiveTask,
      getDeveloperScript,
      taskScript,
    ];
    for (const script of pyScripts) {
      expect(
        script.includes("import") ||
          script.includes("def ") ||
          script.includes("class ") ||
          script.includes("#"),
      ).toBe(true);
    }
  });

  it("scriptsInit is a Python docstring module", () => {
    expect(scriptsInit).toContain('"""');
  });

  it("workflowMdTemplate is markdown", () => {
    expect(workflowMdTemplate).toContain("#");
  });

  it("routes natural-language intent without requiring a command chain", () => {
    const noTask =
      /^\[workflow-state:no_task\]\n([\s\S]*?)^\[\/workflow-state:no_task\]/m.exec(
        workflowMdTemplate,
      )?.[1];
    expect(workflowMdTemplate).toContain(
      "Natural-language intent is the default entry point",
    );
    expect(workflowMdTemplate).toContain(
      "Read-only questions, explanations, reviews, and status checks do not create a development task",
    );
    expect(workflowMdTemplate).toContain(
      "Review revisions reuse the existing task and MR/PR context",
    );
    expect(workflowMdTemplate).toContain(
      "Do not require the user to remember or execute a fixed `/trellis:*` command chain",
    );
    expect(noTask).toContain(
      "explicit commands/skills are standalone controls",
    );
  });

  it("documents the classified Task Basis and creation commands accepted by the governance gate", () => {
    expect(workflowMdTemplate).toContain("`intent.md` — structured Task Basis");
    expect(workflowMdTemplate).toContain(
      "The compatibility filename does not make it a blanket Product Intent requirement",
    );

    const createLines = workflowMdTemplate
      .split("\n")
      .filter((line) => line.includes('task.py create "'));
    expect(createLines.length).toBeGreaterThan(0);
    for (const line of createLines) {
      expect(line, `unclassified create example: ${line}`).toContain(
        "--classification",
      );
    }

    const createStep = stepSection("1.0");
    expect(createStep).toContain("--classification business-feature");
    expect(createStep).toContain("--product-intent-link");
    expect(createStep).toContain("--classification maintenance");
    expect(createStep).toContain("--product-intent-reason");
    expect(createStep).toContain(
      "Readonly and ordinary operational work do not use `task.py create`",
    );

    const exploreStep = stepSection("1.1");
    expect(exploreStep).toContain("Complete `intent.md` as the Task Basis");
    expect(stepSection("1.5")).toContain(
      "`intent.md` contains a complete classified Task Basis",
    );
    expect(workflowMdTemplate).toContain(
      "Every parent and child owns its own classification and Task Basis",
    );
  });

  it("defines risk-driven optional TDD and alternative evidence", () => {
    expect(workflowMdTemplate).toContain(
      "TDD is an optional implementation strategy",
    );
    expect(workflowMdTemplate).toContain(
      "bug regressions, business rules, state machines",
    );
    expect(workflowMdTemplate).toContain(
      "contract tests, integration checks, builds, runtime probes, logs, or explicit manual verification",
    );
    expect(workflowMdTemplate).toContain(
      "provide proportionate alternative verification evidence",
    );
  });

  it("defines shared iteration and MR candidate evidence semantics", () => {
    expect(workflowMdTemplate).toContain("### Quality Evidence Contract");
    expect(workflowMdTemplate).toContain("`ITERATION`");
    expect(workflowMdTemplate).toContain("`MR_CANDIDATE`");
    for (const status of [
      "PASSED",
      "FAILED",
      "NOT_CONFIGURED",
      "NOT_APPLICABLE",
      "SKIPPED",
      "PENDING",
      "UNKNOWN",
      "PLANNED",
    ]) {
      expect(workflowMdTemplate).toContain(`\`${status}\``);
    }
    expect(workflowMdTemplate).toContain(
      "exact source SHA against an exact fetched target SHA",
    );
    expect(workflowMdTemplate).toContain("complete candidate diff");
    expect(workflowMdTemplate).toContain("An exit code of zero alone");
    expect(workflowMdTemplate).toContain(
      "Required facts at `FAILED`, `UNKNOWN`, or `PENDING` cannot support an MR-ready claim",
    );
    expect(workflowMdTemplate).toContain(
      "code, dirty diff, HEAD, target SHA, relevant configuration, or execution-environment changes invalidate affected prior evidence",
    );
    expect(workflowMdTemplate).toContain(
      "`NOT_APPLICABLE` and `SKIPPED` require a reason and, where relevant, alternative evidence",
    );
    expect(workflowMdTemplate).toContain(
      "Do not change Sonar, pipeline, or platform facts merely to manufacture a passing result",
    );
  });

  it("treats jsonl as sub-agent manifests and fails closed while inline still loads specs", () => {
    const planningInline =
      /^\[workflow-state:planning-inline\]\n([\s\S]*?)^\[\/workflow-state:planning-inline\]/m.exec(
        workflowMdTemplate,
      )?.[1];
    const inProgressInline =
      /^\[workflow-state:in_progress-inline\]\n([\s\S]*?)^\[\/workflow-state:in_progress-inline\]/m.exec(
        workflowMdTemplate,
      )?.[1];
    expect(workflowMdTemplate).toContain(
      "They are not activity logs, implementation journals, or quality-result stores",
    );
    expect(workflowMdTemplate).toContain(
      "`check.jsonl` must never be used as a quality-result store",
    );
    expect(workflowMdTemplate).toContain(
      "missing, empty, seed-only, or contains no valid `file` entry",
    );
    expect(workflowMdTemplate).toContain(
      "report the manifest problem to the main session",
    );
    expect(planningInline).toContain("skip jsonl curation only");
    expect(inProgressInline).toContain(
      "Skipping jsonl does not skip specs, review, or risk-appropriate verification",
    );
  });

  it("common check uses iteration evidence instead of absolute unit-test rules", () => {
    const repoRoot = fs.existsSync(path.join(process.cwd(), "packages"))
      ? process.cwd()
      : path.resolve(process.cwd(), "../..");
    const commonCheck = fs.readFileSync(
      path.join(repoRoot, "packages/cli/src/templates/common/skills/check.md"),
      "utf-8",
    );
    expect(commonCheck).toContain("`ITERATION`-profile verification");
    expect(commonCheck).toContain("TDD is optional and risk-driven");
    expect(commonCheck).toContain("alternative verification evidence");
    expect(commonCheck).toContain("`MR_CANDIDATE` claim additionally requires");
    expect(commonCheck).toContain(
      "Required facts at `FAILED`, `UNKNOWN`, or `PENDING` are not green and cannot support an MR-ready claim",
    );
    expect(commonCheck).not.toContain("New function → unit test added?");
    expect(commonCheck).not.toContain("Bug fix → regression test added?");
  });

  it("every platform exposes the shared quality contract on a trellis-check delivery surface", () => {
    for (const id of PLATFORM_IDS) {
      const templates = collectPlatformTemplates(id);
      expect(templates, `${id} should expose tracked templates`).toBeDefined();
      const renderedChecks = [...(templates?.entries() ?? [])].filter(
        ([filePath]) =>
          filePath.includes("trellis-check") &&
          (filePath.endsWith("SKILL.md") ||
            filePath.endsWith(".agent.md") ||
            filePath.endsWith("trellis-check.md") ||
            filePath.endsWith("trellis-check.toml") ||
            filePath.endsWith("trellis-check.json")),
      );
      expect(
        renderedChecks.length,
        `${id} should render at least one trellis-check entry`,
      ).toBeGreaterThan(0);
      expect(
        renderedChecks.some(([, content]) =>
          [
            "`ITERATION`-profile verification",
            "TDD is optional and risk-driven",
            "alternative verification evidence",
            "`MR_CANDIDATE` claim additionally requires",
          ].every((clause) => content.includes(clause)),
        ),
        `${id} should render the shared quality contract on a trellis-check delivery surface`,
      ).toBe(true);
    }
  });

  it.each([
    ["codex", ".codex/agents/trellis-check.toml"],
    ["claude-code", ".claude/agents/trellis-check.md"],
  ] as const)(
    "%s composes the shared quality contract into its actual check executor",
    (platform, executorPath) => {
      const templates = collectPlatformTemplates(platform);
      const executor = templates?.get(executorPath);

      expect(
        executor,
        `${platform} should render ${executorPath}`,
      ).toBeDefined();
      expect(executor).not.toContain("{{TRELLIS_CHECK_CONTRACT}}");
      expect(executor).toContain("`ITERATION`-profile verification");
      expect(executor).toContain("git diff HEAD");
      expect(executor).toContain("git diff --cached --no-ext-diff");
      expect(executor).toContain("git status --short");
      expect(executor).toContain("git ls-files --others --exclude-standard");
      expect(executor).toContain(
        "inspect the full contents of every untracked, non-ignored file",
      );
      expect(executor).toContain(
        "final structured Agent report is the independent `ITERATION` evidence artifact",
      );
      expect(executor).toContain("Profile: `ITERATION`");
      expect(executor).toContain(
        "final staged/unstaged/untracked content digests",
      );
      expect(executor).toContain(
        "`MR_CANDIDATE` remains unavailable until the repository's merge-request gate",
      );
      expect(executor).toContain(
        "`check.jsonl` is only a sub-agent context manifest; never write quality results into it",
      );
    },
  );

  it.each([
    [
      "codex",
      ".codex/agents/trellis-check.toml",
      ".agents/skills/trellis-check/SKILL.md",
    ],
    [
      "claude-code",
      ".claude/agents/trellis-check.md",
      ".claude/skills/trellis-check/SKILL.md",
    ],
  ] as const)(
    "%s checked-in check surfaces match the collector byte for byte",
    (platform, executorPath, skillPath) => {
      const repoRoot = fs.existsSync(path.join(process.cwd(), "packages"))
        ? process.cwd()
        : path.resolve(process.cwd(), "../..");
      const templates = collectPlatformTemplates(platform);

      for (const filePath of [executorPath, skillPath]) {
        expect(
          fs.readFileSync(path.join(repoRoot, filePath), "utf-8"),
          `${filePath} should be regenerated from ${platform}'s collector`,
        ).toBe(templates?.get(filePath));
      }
    },
  );

  it("[codex-native-subagents] workflow.md preserves the dispatch prompt for Codex native fallback", () => {
    // The in_progress breadcrumb instructs the main agent to prefix
    // dispatch prompts with "Active task: <path>". Codex uses native
    // SubagentStart context injection, but retains this child-side fallback
    // whenever a project hook is unavailable or untrusted.
    const block = inProgressBreadcrumb();
    expect(block).toContain("Active task:");
    expect(workflowMdTemplate).toContain("native Codex `SubagentStart`");
    expect(workflowMdTemplate).toContain("child-side pull fallback");
  });

  it("[codex-native-subagents] Codex uses the native hook implement block, while class-2 platforms stay pull-based", () => {
    const implement = stepSection("2.1");
    const hookAutoBlock = platformBlock(
      implement,
      "[Claude Code, Cursor, OpenCode, codex-sub-agent, CodeBuddy, Droid, Pi, ZCode, Snow, Oh My Pi]",
    );
    const pullBasedMarker =
      "[Gemini, Qoder, Copilot, Reasonix, Trae, Grok, Kimi Code]";
    const pullBasedBlock = platformBlock(implement, pullBasedMarker);

    const workflowLabelByPlatform: Partial<Record<AITool, string>> = {
      gemini: "Gemini",
      qoder: "Qoder",
      copilot: "Copilot",
      trae: "Trae",
      grok: "Grok",
      kimi: "Kimi Code",
    };
    // Pi templates keep a pull-based fallback, but workflow 2.1 routes Pi
    // through the extension-backed context path.
    const extensionBackedPreludeFallbackPlatforms = new Set<AITool>(["pi"]);
    // Codex retains a child-side prelude as a compatibility fallback, but
    // its primary workflow route is the native SubagentStart hook block.
    const nativePushPreludeFallbackPlatforms = new Set<AITool>(["codex"]);
    const generatedPullBasedLabels = PLATFORM_IDS.flatMap((id) => {
      if (
        extensionBackedPreludeFallbackPlatforms.has(id) ||
        nativePushPreludeFallbackPlatforms.has(id)
      ) {
        return [];
      }
      const templates = collectPlatformTemplates(id);
      const hasPullBasedPrelude =
        templates !== undefined &&
        [...templates.entries()].some(
          ([filePath, content]) =>
            /trellis-(implement|check)/.test(filePath) &&
            content.includes("Required: Load Trellis Context First"),
        );
      if (!hasPullBasedPrelude) {
        return [];
      }
      const label = workflowLabelByPlatform[id];
      expect(
        label,
        `${id} generates pull-based agent definitions but has no workflow marker mapping`,
      ).toBeDefined();
      return [label as string];
    });

    const pullBasedLabels = [...generatedPullBasedLabels, "Reasonix"];
    for (const label of pullBasedLabels) {
      expect(
        pullBasedBlock,
        `${label} must use pull-based 2.1 guidance`,
      ).toContain(label);
      expect(
        hookAutoBlock,
        `${label} must not use hook/plugin auto-handles 2.1 guidance`,
      ).not.toContain(label);
    }
    expect(pullBasedBlock).toContain(
      "The pull-based sub-agent definition auto-handles the context load requirement",
    );
    expect(hookAutoBlock).toContain("codex-sub-agent");
    expect(hookAutoBlock).toContain("SubagentStart");
  });

  it("[codex-native-subagents] template mode helpers default to auto and fail invalid values closed to inline", () => {
    const scripts = getAllScripts();
    const config = scripts.get("common/config.py") ?? "";
    const workflowPhase = scripts.get("common/workflow_phase.py") ?? "";
    const taskStore = scripts.get("common/task_store.py") ?? "";

    expect(config).toContain('DEFAULT_CODEX_DISPATCH_MODE = "auto"');
    expect(config).toContain('if mode == "sub-agent":');
    expect(config).toContain('return "auto"');
    expect(config).toContain("using inline");
    expect(workflowPhase).toContain('mode = "auto"');
    expect(workflowPhase).toContain(
      'return "codex-sub-agent" if mode == "auto" else "codex-inline"',
    );
    expect(taskStore).toContain('get_codex_dispatch_mode(repo_root) == "auto"');
  });

  it("[issue-237] workflow.md in_progress breadcrumb self-exempts implement/check sub-agents", () => {
    // The in_progress breadcrumb may be injected into sub-agent turns on some
    // hosts, so its main-session dispatch guidance must not recursively apply
    // to a sub-agent that is already doing the requested work.
    const block = inProgressBreadcrumb();
    expect(block).toContain("Main-session default");
    expect(block).toContain("Sub-agent self-exemption");
    expect(block).toContain("already running as `trellis-implement`");
    expect(block).toContain("do NOT spawn another `trellis-implement`");
    expect(block).toContain("already running as `trellis-check`");
    expect(block).toContain("do NOT spawn another `trellis-check`");
    expect(block).toContain("main session only");
  });

  it("[issue-237] workflow.md Phase 2 dispatch steps require prompt recursion guards", () => {
    expect(workflowMdTemplate).toContain("**Dispatch prompt guard**");
    expect(workflowMdTemplate).toContain(
      "already the `trellis-implement` sub-agent",
    );
    expect(workflowMdTemplate).toContain(
      "not spawn another `trellis-implement` / `trellis-check`",
    );
    expect(workflowMdTemplate).toContain(
      "already the `trellis-check` sub-agent",
    );
    expect(workflowMdTemplate).toContain(
      "not spawn another `trellis-check` / `trellis-implement`",
    );
  });

  it("workflow.md documents parent child task tree responsibilities", () => {
    expect(workflowMdTemplate).toContain("### Parent / Child Task Trees");
    expect(workflowMdTemplate).toContain(
      "several independently verifiable deliverables",
    );
    expect(workflowMdTemplate).toContain(
      "Parent/child structure is not a dependency system",
    );
    expect(workflowMdTemplate).toContain("--parent <parent-dir>");
    expect(workflowMdTemplate).toContain(
      "task.py add-subtask <parent> <child>",
    );
    expect(workflowMdTemplate).toContain(
      "start the child that owns the next independently verifiable deliverable",
    );
  });

  it("workflow.md step 1.1 includes parent child split guidance", () => {
    const step = stepSection("1.1");
    expect(step).toContain("When considering a parent/child split");
    expect(step).toContain("Parent tasks own source requirements");
    expect(step).toContain("Child tasks own actual deliverables");
    expect(step).toContain("Parent/child structure is not a dependency system");
    expect(step).toContain("Do not start the parent unless");
  });

  it("workflow.md planning breadcrumbs mention parent child split guidance", () => {
    const planning = workflowStateBreadcrumb("planning");
    const planningInline = workflowStateBreadcrumb("planning-inline");
    for (const block of [planning, planningInline]) {
      expect(block).toContain("Multi-deliverable scope");
      expect(block).toContain(
        "parent task plus independently verifiable child tasks",
      );
      expect(block).toContain("not implied by tree position");
    }
  });

  it("gitignoreTemplate contains ignore patterns", () => {
    expect(gitignoreTemplate).toContain(".developer");
    expect(gitignoreTemplate).toContain("__pycache__");
  });
});

// =============================================================================
// getAllScripts — pure function assembling pre-loaded strings
// =============================================================================

describe("getAllScripts", () => {
  it("returns a Map", () => {
    const scripts = getAllScripts();
    expect(scripts).toBeInstanceOf(Map);
  });

  it("contains expected script entries", () => {
    const scripts = getAllScripts();
    expect(scripts.has("__init__.py")).toBe(true);
    expect(scripts.has("common/__init__.py")).toBe(true);
    expect(scripts.has("common/paths.py")).toBe(true);
    expect(scripts.has("common/active_task.py")).toBe(true);
    expect(scripts.has("task.py")).toBe(true);
    expect(scripts.has("get_developer.py")).toBe(true);
  });

  it("has at least one entry", () => {
    const scripts = getAllScripts();
    expect(scripts.size).toBeGreaterThan(0);
  });

  it("all values are non-empty strings", () => {
    const scripts = getAllScripts();
    for (const [key, value] of scripts) {
      expect(value.length, `${key} should be non-empty`).toBeGreaterThan(0);
    }
  });

  it("values match the exported constants", () => {
    const scripts = getAllScripts();
    expect(scripts.get("__init__.py")).toBe(scriptsInit);
    expect(scripts.get("common/__init__.py")).toBe(commonInit);
    expect(scripts.get("task.py")).toBe(taskScript);
  });

  it("does not contain multi_agent entries", () => {
    const scripts = getAllScripts();
    for (const [key] of scripts) {
      expect(key, `${key} should not be a multi_agent script`).not.toContain(
        "multi_agent",
      );
    }
  });
});

// =============================================================================
// getAllAgents — channel runtime agent definitions dispatched at init/update.
// agent-loader.ts loads `.trellis/agents/<name>.md` and requires `---` YAML
// frontmatter at the top with a flat `name: <name>` field. These tests pin the
// contract so a future template edit can't silently break channel spawn.
// =============================================================================

describe("getAllAgents", () => {
  it("ships implement and check agents", () => {
    const agents = getAllAgents();
    expect(agents.has("implement.md")).toBe(true);
    expect(agents.has("check.md")).toBe(true);
  });

  it("values match exported constants", () => {
    const agents = getAllAgents();
    expect(agents.get("implement.md")).toBe(implementAgentTemplate);
    expect(agents.get("check.md")).toBe(checkAgentTemplate);
  });

  it("each agent body starts with `---` frontmatter and a matching name field", () => {
    const agents = getAllAgents();
    for (const [file, content] of agents) {
      expect(
        content.startsWith("---\n"),
        `${file} must start with --- frontmatter`,
      ).toBe(true);
      // Frontmatter must close on a `---\n` line.
      const frontmatterClose = content.indexOf("\n---\n", 4);
      expect(
        frontmatterClose,
        `${file} must have a closing --- frontmatter line`,
      ).toBeGreaterThan(0);
      const frontmatter = content.slice(4, frontmatterClose);
      // The agent's `name:` field must match the file basename so
      // `trellis channel spawn --agent <name>` resolves correctly.
      const expectedName = file.replace(/\.md$/, "");
      const nameLine = frontmatter
        .split("\n")
        .find((line) => /^name\s*:/.test(line));
      expect(nameLine, `${file} must declare a name field`).toBeTruthy();
      expect(
        nameLine?.split(":")[1]?.trim(),
        `${file} name field should equal "${expectedName}"`,
      ).toBe(expectedName);
    }
  });
});

// =============================================================================
// config.yaml — context_injection section (issue #441)
// =============================================================================

describe("configYamlTemplate: context_injection section", () => {
  it("documents the context_injection block, fully commented out", () => {
    expect(configYamlTemplate).toContain("context_injection:");
    expect(configYamlTemplate).toContain("#   max_file_bytes: 32768");
    expect(configYamlTemplate).toContain("#   max_artifact_bytes: 65536");
    expect(configYamlTemplate).toContain("#   max_total_bytes: 131072");
    // Every context_injection line must be commented — the section ships
    // inert by default (matches the codex.dispatch_mode precedent).
    const lines = configYamlTemplate.split("\n");
    const start = lines.findIndex((l) => l.includes("context_injection:"));
    expect(start).toBeGreaterThan(-1);
    for (const line of lines.slice(start, start + 4)) {
      expect(line.trimStart().startsWith("#")).toBe(true);
    }
  });
});
