import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import chalk from "chalk";
import figlet from "figlet";
import inquirer from "inquirer";
import { createWorkflowStructure } from "../configurators/workflow.js";
import {
  getInitToolChoices,
  resolveCliFlag,
  configurePlatform,
  getConfiguredPlatforms,
  getPlatformsWithPythonHooks,
} from "../configurators/index.js";
import {
  getPythonCommandForPlatform,
  setResolvedPythonCommand,
} from "../configurators/shared.js";
import { AI_TOOLS, type CliFlag } from "../types/ai-tools.js";
import { DIR_NAMES, FILE_NAMES, PATHS } from "../constants/paths.js";
import { VERSION } from "../constants/version.js";
import { agentsMdContent } from "../templates/markdown/index.js";
import {
  setWriteMode,
  startRecordingWrites,
  stopRecordingWrites,
  writeFile,
  type WriteMode,
} from "../utils/file-writer.js";
import { emptyTaskJson, type TaskJson } from "../utils/task-json.js";
import {
  detectProjectType,
  detectMonorepo,
  sanitizePkgName,
  type ProjectType,
  type DetectedPackage,
} from "../utils/project-detector.js";
import { initializeHashes, removeHash } from "../utils/template-hash.js";
import {
  NATIVE_WORKFLOW_ID,
  resolveWorkflowTemplate,
} from "../utils/workflow-resolver.js";
import {
  isCwdHomedir,
  homedirGuardMessage,
  homedirBypassEnabled,
} from "../utils/cwd-guard.js";
import {
  loadSpecRegistryConfig,
  writeSpecRegistryConfig,
  type SpecRegistryConfig,
} from "../utils/registry-config.js";
import {
  fetchTemplateIndex,
  probeRegistryIndex,
  downloadTemplateById,
  downloadRegistryDirect,
  parseRegistrySource,
  TIMEOUTS,
  TEMPLATE_INDEX_URL,
  type SpecTemplate,
  type TemplateStrategy,
  type RegistrySource,
  type RegistryBackend,
} from "../utils/template-fetcher.js";
import { setupProxy, maskProxyUrl } from "../utils/proxy.js";
import { toPosix } from "../utils/posix.js";
import { updateHashes } from "../utils/template-hash.js";

const MIN_PYTHON_MAJOR = 3;
const MIN_PYTHON_MINOR = 9;
const PYTHON_VERSION_RE = /Python (\d+)\.(\d+)/;

function collectSpecPaths(cwd: string): Set<string> {
  const specRoot = path.join(cwd, PATHS.SPEC);
  const paths = new Set<string>();
  if (!fs.existsSync(specRoot)) return paths;

  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        paths.add(toPosix(path.relative(cwd, fullPath)));
      }
    }
  };
  walk(specRoot);
  return paths;
}

function hasMeaningfulSpecBaseline(cwd: string): boolean {
  const nonEmptySpecPaths = [...collectSpecPaths(cwd)].filter(
    (relativePath) => {
      if (path.posix.extname(relativePath).toLowerCase() !== ".md")
        return false;
      try {
        return (
          fs.readFileSync(path.join(cwd, relativePath), "utf-8").trim().length >
          0
        );
      } catch {
        return false;
      }
    },
  );
  if (nonEmptySpecPaths.length === 0) return false;

  // A registry-backed baseline may intentionally consist of a single root
  // index. Without provenance, a lone index is too weak to distinguish a
  // loaded team baseline from an aborted or placeholder-only init.
  if (loadSpecRegistryConfig(cwd)) return true;
  const rootIndex = path.posix.join(toPosix(PATHS.SPEC), "index.md");
  return nonEmptySpecPaths.some((relativePath) => relativePath !== rootIndex);
}

export function isSupportedPythonVersion(versionOutput: string): boolean {
  const match = versionOutput.match(PYTHON_VERSION_RE);
  if (!match) return false;

  const major = Number(match[1]);
  const minor = Number(match[2]);
  return (
    major > MIN_PYTHON_MAJOR ||
    (major === MIN_PYTHON_MAJOR && minor >= MIN_PYTHON_MINOR)
  );
}

// Sentinel returned when child_process spawn is blocked by a sandbox / kernel
// policy (e.g. seccomp inside Codex's Linux sandbox). EPERM/EACCES here mean
// "the kernel refused the spawn" — NOT "python3 isn't installed". The host
// usually has python3 on PATH; we just can't probe it from this Node process.
type PythonProbe = string | null | "sandbox-restricted";

function detectPythonVersion(command: string): PythonProbe {
  try {
    return execSync(`${command} --version`, {
      encoding: "utf-8",
      stdio: "pipe",
    }).trim();
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "EPERM" || code === "EACCES") {
      return "sandbox-restricted";
    }
    return null;
  }
}

export function requireSupportedPython(command: string): string {
  // Final escape hatch — set when the user knows python3 is on PATH but
  // the probe keeps failing for environment-specific reasons.
  if (process.env.TRELLIS_SKIP_PYTHON_CHECK === "1") {
    return `version check skipped (TRELLIS_SKIP_PYTHON_CHECK=1)`;
  }

  const versionOutput = detectPythonVersion(command);

  if (versionOutput === "sandbox-restricted") {
    console.warn(
      chalk.yellow(
        `⚠ Python version check skipped — sandboxed environment blocked ` +
          `child_process spawn (EPERM/EACCES). Assuming "${command}" is on ` +
          `PATH. If init fails later, re-run on the host or set ` +
          `TRELLIS_SKIP_PYTHON_CHECK=1.`,
      ),
    );
    return `version unknown (sandbox-restricted)`;
  }

  if (!versionOutput) {
    throw new Error(
      `Python command "${command}" not found. Trellis init requires Python ≥ 3.9.`,
    );
  }

  if (!isSupportedPythonVersion(versionOutput)) {
    throw new Error(
      `${versionOutput} detected via "${command}", but Trellis init requires Python ≥ 3.9.`,
    );
  }

  return versionOutput;
}

/**
 * Candidate Python command list per platform.
 *
 * Windows: `python` is the usual python.org installer choice, but Microsoft
 * Store ships `python3`, and the `py` launcher is `py -3`. We try all three
 * before giving up — fixes #236 where users with only `python3` (not
 * `python`) had `trellis init` fail outright.
 *
 * Non-Windows: `python3` is canonical; `python` is a fallback for systems
 * where Python 3 is the only Python and is named `python` (some Arch
 * configs, conda envs).
 */
const PYTHON_CANDIDATES: Record<"win32" | "other", readonly string[]> = {
  win32: ["python", "python3", "py -3"],
  other: ["python3", "python"],
};

/**
 * Detect a working Python ≥ 3.9 command on the host platform.
 *
 * Honors `TRELLIS_PYTHON_CMD` (explicit override, no probe) and
 * `TRELLIS_SKIP_PYTHON_CHECK=1` (skip probe, trust platform default).
 *
 * Otherwise tries each candidate in `PYTHON_CANDIDATES` in order and returns
 * the first whose `--version` matches `Python ≥ 3.9`. Caches the result via
 * `setResolvedPythonCommand` so all downstream template / configurator
 * writes pick up the resolved value.
 *
 * Throws a helpful, Windows-aware error if no candidate works.
 */
export function resolveSupportedPython(): {
  command: string;
  version: string;
} {
  // Explicit override — user knows their environment.
  const override = process.env.TRELLIS_PYTHON_CMD?.trim();
  if (override) {
    setResolvedPythonCommand(override);
    return { command: override, version: "set via TRELLIS_PYTHON_CMD" };
  }

  // Skip probe entirely.
  if (process.env.TRELLIS_SKIP_PYTHON_CHECK === "1") {
    const fallback = getPythonCommandForPlatform();
    setResolvedPythonCommand(fallback);
    return {
      command: fallback,
      version: "version check skipped (TRELLIS_SKIP_PYTHON_CHECK=1)",
    };
  }

  const candidates =
    process.platform === "win32"
      ? PYTHON_CANDIDATES.win32
      : PYTHON_CANDIDATES.other;

  const probeFailures: string[] = [];
  for (const candidate of candidates) {
    const probe = detectPythonVersion(candidate);
    if (probe === "sandbox-restricted") {
      console.warn(
        chalk.yellow(
          `⚠ Python version check skipped — sandboxed environment blocked ` +
            `child_process spawn (EPERM/EACCES). Assuming "${candidate}" is ` +
            `on PATH. If init fails later, re-run on the host or set ` +
            `TRELLIS_SKIP_PYTHON_CHECK=1.`,
        ),
      );
      setResolvedPythonCommand(candidate);
      return {
        command: candidate,
        version: "version unknown (sandbox-restricted)",
      };
    }
    if (!probe) {
      probeFailures.push(`${candidate}: not found`);
      continue;
    }
    if (!isSupportedPythonVersion(probe)) {
      probeFailures.push(`${candidate}: ${probe} (< 3.9)`);
      continue;
    }
    setResolvedPythonCommand(candidate);
    return { command: candidate, version: probe };
  }

  const isWindows = process.platform === "win32";
  const installHint = isWindows
    ? `Install Python ≥ 3.9 from https://www.python.org/downloads/windows/ — make sure ` +
      `"Add Python to PATH" is checked in the installer. Or, if Python is ` +
      `installed under a different name, set TRELLIS_PYTHON_CMD=<your-cmd> ` +
      `before re-running init (e.g. \`set TRELLIS_PYTHON_CMD=py -3\`).`
    : `Install Python ≥ 3.9 from https://www.python.org/downloads/ or via your ` +
      `package manager. Or set TRELLIS_PYTHON_CMD=<your-cmd> before re-running.`;

  throw new Error(
    `No supported Python command found. Tried: ${candidates.join(", ")}.\n` +
      `Probe results:\n  ${probeFailures.join("\n  ")}\n\n` +
      `Trellis init requires Python ≥ 3.9. ${installHint}\n` +
      `Last-resort escape hatch: set TRELLIS_SKIP_PYTHON_CHECK=1 to skip the probe entirely.`,
  );
}

function getOsDisplayName(
  platform: NodeJS.Platform = process.platform,
): string {
  switch (platform) {
    case "win32":
      return "Windows";
    case "darwin":
      return "macOS";
    case "linux":
      return "Linux";
    default:
      return platform;
  }
}

function logPythonAdaptationNotice(command: string): void {
  const osName = getOsDisplayName();
  console.log(
    chalk.blue(
      `📌 ${osName} detected: Trellis rendered Python commands as "${command}" in generated hooks, settings, and help text`,
    ),
  );
}

// =============================================================================
// Bootstrap Task Creation
// =============================================================================

const BOOTSTRAP_TASK_NAME = "00-bootstrap-guidelines";
const AUTO_ONBOARDING_CLASSIFICATION = "maintenance";
const AUTO_ONBOARDING_PRODUCT_INTENT_REASON =
  "Trellis bootstrap and onboarding maintain engineering workflow context without adding a business-facing product capability.";

type AutoOnboardingTaskKind = "creator-bootstrap" | "joiner-onboarding";

/**
 * Slugify a developer name for safe use in task directory names.
 *
 * Unlike `sanitizePkgName` (which only strips npm @scope/ prefixes), this
 * handles arbitrary developer input: spaces, Unicode letters, punctuation,
 * path separators. Returns "user" fallback when input slugifies to empty.
 *
 * Exported for unit testing; not part of the public API.
 */
export function slugifyDeveloperName(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "user";
}

/**
 * Write a classified planning task skeleton.
 *
 * Idempotent: if the task dir already exists, returns true without touching
 * anything. Shared by both creator bootstrap and joiner onboarding flows.
 */
function writeTaskSkeleton(
  cwd: string,
  taskName: string,
  taskJson: TaskJson,
  prdContent: string,
  intentContent: string,
): boolean {
  const taskDir = path.join(cwd, PATHS.TASKS, taskName);
  if (fs.existsSync(taskDir)) return true; // idempotent

  try {
    fs.mkdirSync(taskDir, { recursive: true });
    fs.writeFileSync(
      path.join(taskDir, FILE_NAMES.TASK_JSON),
      JSON.stringify(taskJson, null, 2),
      "utf-8",
    );
    fs.writeFileSync(path.join(taskDir, FILE_NAMES.PRD), prdContent, "utf-8");
    fs.writeFileSync(path.join(taskDir, "intent.md"), intentContent, "utf-8");
    return true;
  } catch {
    return false;
  }
}

function getAutoOnboardingTaskBasis(
  kind: AutoOnboardingTaskKind,
  developer: string,
): string {
  const requestedOutcome =
    kind === "creator-bootstrap"
      ? "Review the loaded Trellis spec baseline and resolve only evidence-backed project-specific gaps."
      : `Orient ${developer} to the existing Trellis workflow and project specifications without changing the team's baseline.`;
  const inScope =
    kind === "creator-bootstrap"
      ? "Inspect the loaded spec baseline, compare it with repository evidence, and record genuine project-specific gaps or a no-gap conclusion."
      : "Read and summarize the existing workflow, specifications, archived-task rhythm, and assigned work for the joining developer.";
  const outOfScope =
    kind === "creator-bootstrap"
      ? "Business product changes and generic rules that are not supported by repository evidence."
      : "Changing project specifications, implementing product work, or creating practice tasks without developer approval.";
  const verification =
    kind === "creator-bootstrap"
      ? "The fit/gap review records repository evidence, resolves each credible gap, and explicitly records when no project-specific gap exists."
      : "The developer can explain the workflow entry point, locate the project specifications, and identify their assigned work or confirm that none exists.";

  return `# Task Basis

## Classification

${AUTO_ONBOARDING_CLASSIFICATION}

## Product Intent

Status: NOT_REQUIRED
Link:
Reason: ${AUTO_ONBOARDING_PRODUCT_INTENT_REASON}

## Requested Outcome

${requestedOutcome}

## In Scope / Out of Scope

- In scope: ${inScope}
- Out of scope: ${outOfScope}

## Acceptance or Verification Basis

- ${verification}
`;
}

/**
 * Compute the bootstrap checklist items (previously stored as structured
 * `subtasks: [{name, status}]` in task.json). Per task 04-21-task-schema-unify
 * (D1), these live as markdown `- [ ]` items in prd.md instead, so task.json
 * stays canonical with `subtasks: string[]` (child task dir names, same as
 * task_store.py).
 */
function getBootstrapChecklistItems(
  projectType: ProjectType,
  packages?: DetectedPackage[],
  loadedSpecSource?: string,
  specSourceLoaded = false,
  specPaths: readonly string[] = [],
): string[] {
  const scope =
    packages && packages.length > 0
      ? `packages: ${packages.map((pkg) => pkg.name).join(", ")}`
      : `${projectType} project`;

  return [
    loadedSpecSource && specSourceLoaded && specPaths.length > 0
      ? `Confirm the loaded spec source and its coverage (${loadedSpecSource})`
      : loadedSpecSource
        ? `Verify or repair the configured spec source because it was not loaded during this init (${loadedSpecSource})`
        : "Inventory existing project guidance and generated spec scaffolding",
    `Review project-specific fit and gaps for ${scope}`,
    "Add or adjust only evidence-backed project rules where gaps exist",
    "Record either the resolved gaps or an explicit no-gap conclusion",
  ];
}

function getBootstrapRelatedFiles(specPaths: readonly string[]): string[] {
  if (specPaths.length === 0) return [`${PATHS.SPEC}/`];

  const specRoot = `${toPosix(PATHS.SPEC).replace(/\/$/, "")}/`;
  const reviewAreas = new Set<string>();
  for (const specPath of specPaths) {
    const normalized = toPosix(specPath);
    const relative = normalized.startsWith(specRoot)
      ? normalized.slice(specRoot.length)
      : normalized;
    const segments = relative.split("/").filter(Boolean);
    reviewAreas.add(
      segments.length > 1 ? `${specRoot}${segments[0]}/` : normalized,
    );
  }
  return [...reviewAreas].sort();
}

function getBootstrapPrdContent(
  projectType: ProjectType,
  pythonCmd: string,
  packages?: DetectedPackage[],
  loadedSpecSource?: string,
  specSourceLoaded = false,
  specPaths: readonly string[] = [],
): string {
  const checklistItems = getBootstrapChecklistItems(
    projectType,
    packages,
    loadedSpecSource,
    specSourceLoaded,
    specPaths,
  );
  const checklistMarkdown = checklistItems
    .map((item) => `- [ ] ${item}`)
    .join("\n");

  const sourceStatus = loadedSpecSource
    ? specSourceLoaded && specPaths.length > 0
      ? `A spec registry or template was loaded during init: **${loadedSpecSource}**. Treat it as the starting point and review only this repository's differences.`
      : `A spec source is configured as **${loadedSpecSource}**, but this init did not confirm a successful load from it. Treat the source-backed baseline as missing or partial, verify or repair it, and distinguish any generated fallback files from team-owned guidance.`
    : specPaths.length > 0
      ? `No external spec registry or template was loaded during init. Treat the generated files as scaffolding, then add only conventions supported by repository evidence.`
      : `No spec files were detected. Establish or repair the baseline before reviewing project-specific gaps.`;
  const specInventory =
    specPaths.length > 0
      ? specPaths.map((specPath) => `- \`${specPath}\``).join("\n")
      : "- No spec files detected.";

  const header = `# Bootstrap Task: Review Project Spec Fit and Gaps

**You (the AI) are running this task. The developer does not read this file.**

The developer just ran \`trellis init\` on this project for the first time.
\`.trellis/\` now exists, and this bootstrap task lives under
\`.trellis/tasks/\`. When they want to work on it, they should start this task
from a session that provides Trellis session identity.

**Detected spec state**: ${sourceStatus}

**Your job**: run a project-spec fit/gap review. First establish what team
spec, registry, template, or existing project guidance is already present.
Then inspect only the project-specific differences: technology stack, build
and verification commands, module boundaries, domain patterns, and local
exceptions. Do not copy a general company or framework rulebook into this
repository.

Don't dump instructions. Open with a short greeting, figure out if the repo
has any existing convention docs (CLAUDE.md, .cursorrules, etc.), and drive
the rest conversationally.

---

## Goal

Review the loaded Trellis spec baseline against repository evidence and resolve
only genuine project-specific gaps.

## Requirements

- Establish which registry, template, team spec, or project guidance is the
  current baseline.
- Check the repository's stack, module boundaries, domain patterns, and
  verification commands against that baseline.
- Add or adjust rules only when repository evidence demonstrates a real gap;
  an explicit no-gap conclusion is valid.

## Acceptance Criteria

- [ ] The loaded baseline and its coverage are recorded.
- [ ] Every reported project-specific gap cites repository evidence and is
  resolved with the smallest appropriate spec change.
- [ ] If no credible gap exists, the task records that conclusion without
  manufacturing boilerplate.

---

## Status (update the checkboxes as you complete each item)

${checklistMarkdown}

---

## Detected spec inventory

This list comes from the files actually present after initialization. Review
these paths; do not assume generic backend/frontend files exist when a registry
or template uses a different layout.

${specInventory}

---

## How to review the spec

### Step 1: Establish the loaded baseline

Inspect \`.trellis/config.yaml\` for a registry-backed spec source, then read
the current \`.trellis/spec/\` indexes and relevant files. Also search for
existing convention documents. A loaded team template is already the baseline;
do not rewrite or duplicate it merely to prove bootstrap happened.

Search the repo for existing convention docs. If any exist, read them and
use them as evidence when checking whether the loaded baseline fits this
project.

| File / Directory | Tool |
|------|------|
| \`CLAUDE.md\` / \`CLAUDE.local.md\` | Claude Code |
| \`AGENTS.md\` | Codex / Claude Code / agent-compatible tools |
| \`.cursorrules\` | Cursor |
| \`.cursor/rules/*.mdc\` | Cursor (rules directory) |
| \`.windsurfrules\` | Windsurf |
| \`.clinerules\` | Cline |
| \`.roomodes\` | Roo Code |
| \`.github/copilot-instructions.md\` | GitHub Copilot |
| \`.vscode/settings.json\` → \`github.copilot.chat.codeGeneration.instructions\` | VS Code Copilot |
| \`CONVENTIONS.md\` / \`.aider.conf.yml\` | aider |
| \`CONTRIBUTING.md\` | General project conventions |
| \`.editorconfig\` | Editor formatting rules |

### Step 2: Review only project-specific fit and gaps

Check the actual technology stack, build and verification commands, package or
module boundaries, domain-specific patterns, and deliberate local exceptions.
Before changing a spec file:
- Find 2-3 real examples of each pattern in the codebase.
- Reference real file paths (not hypothetical ones).
- Confirm the rule is missing or materially inaccurate in the loaded baseline.

### Step 3: Resolve gaps, or finish with no gaps

If a real gap exists, make the smallest evidence-backed addition or correction.
If no gap exists, record that conclusion in this task and complete bootstrap
without changing spec files. Never manufacture content to make the checklist
look filled.

**Critical**: document what the code *actually does*, not what it should do.
Aspirational patterns that don't exist in the codebase will cause future agents
to write code that looks out of place.

If the team has known tech debt, document the current state — improvement
is a separate conversation, not a bootstrap concern.

---

## Quick explainer of the runtime (share when they ask "why do we need spec at all")

- Trellis routes work from the natural-language request and current task state.
- In sub-agent dispatch mode, curated \`implement.jsonl\` / \`check.jsonl\`
  manifests list the task-specific spec context for implement/check workers.
- In inline mode, the main agent reads the applicable task and spec context
  directly; it does not spawn implement/check workers merely to follow a fixed
  ritual.
- Source of truth: \`.trellis/spec/\`. That's why filling it well now pays
  off forever.

---

## Completion

This task is intentionally created in \`planning\` status. Before doing the
fit/gap review, activate it through the normal lifecycle and governance gate:

\`\`\`bash
${pythonCmd} ./.trellis/scripts/task.py start 00-bootstrap-guidelines
\`\`\`

When the fit/gap review has evidence and every real gap is resolved — including
the valid conclusion that there are no project-specific gaps — complete and
archive this task through the normal Trellis lifecycle. If direct commands are
needed on the current host, use:

\`\`\`bash
${pythonCmd} ./.trellis/scripts/task.py finish
${pythonCmd} ./.trellis/scripts/task.py archive 00-bootstrap-guidelines
\`\`\`

After archive, every new developer who joins this project will get a
\`00-join-<slug>\` onboarding task instead of this bootstrap task.

---

## Suggested opening line

"Welcome to Trellis! I'll first check which team specs or templates are already
loaded, then review only this project's stack, modules, domain patterns, and
verification commands for genuine gaps. If the baseline already fits, we can
finish without inventing new spec content."
`;

  return header;
}

function getBootstrapTaskJson(
  developer: string,
  projectType: ProjectType,
  loadedSpecSource?: string,
  specSourceLoaded = false,
  specPaths: readonly string[] = [],
): TaskJson {
  const today = new Date().toISOString().split("T")[0];
  const relatedFiles = getBootstrapRelatedFiles(specPaths);

  // Canonical 24-field shape via emptyTaskJson factory.
  // Checklist items (previously stored as structured `subtasks`) are now
  // rendered as `- [ ]` items in prd.md; task.json.subtasks is always
  // string[] (child task dir names) per the canonical schema.
  return emptyTaskJson({
    id: BOOTSTRAP_TASK_NAME,
    name: BOOTSTRAP_TASK_NAME,
    title: "Review Project Spec Fit and Gaps",
    description:
      "Review loaded team specs and add only evidence-backed project-specific gaps",
    status: "planning",
    dev_type: "docs",
    priority: "P1",
    creator: developer,
    assignee: developer,
    createdAt: today,
    relatedFiles,
    meta: {
      classification: AUTO_ONBOARDING_CLASSIFICATION,
      product_intent: "NOT_REQUIRED",
      product_intent_reason: AUTO_ONBOARDING_PRODUCT_INTENT_REASON,
    },
    notes: loadedSpecSource
      ? `First-time fit/gap review created by trellis init (${projectType} project); spec source: ${loadedSpecSource}; load status: ${specSourceLoaded ? "loaded" : "configured but unconfirmed"}; detected ${specPaths.length} spec file(s)`
      : `First-time fit/gap review created by trellis init (${projectType} project); no external spec source detected; detected ${specPaths.length} spec file(s)`,
  });
}

/**
 * Create bootstrap task for first-time setup
 */
function createBootstrapTask(
  cwd: string,
  developer: string,
  pythonCmd: string,
  projectType: ProjectType,
  packages?: DetectedPackage[],
  loadedSpecSource?: string,
  specSourceLoaded = false,
  specPaths: readonly string[] = [],
): boolean {
  const taskJson = getBootstrapTaskJson(
    developer,
    projectType,
    loadedSpecSource,
    specSourceLoaded,
    specPaths,
  );
  const prdContent = getBootstrapPrdContent(
    projectType,
    pythonCmd,
    packages,
    loadedSpecSource,
    specSourceLoaded,
    specPaths,
  );
  const intentContent = getAutoOnboardingTaskBasis(
    "creator-bootstrap",
    developer,
  );
  return writeTaskSkeleton(
    cwd,
    BOOTSTRAP_TASK_NAME,
    taskJson,
    prdContent,
    intentContent,
  );
}

// =============================================================================
// Joiner Onboarding Task Creation
// =============================================================================

/**
 * task.json factory for joiner onboarding. Mirrors the bootstrap factory but
 * uses dev_type "docs", higher priority "P1", and the developer-specific task
 * name (so multiple joiners in the same checkout don't collide).
 */
function getJoinerTaskJson(developer: string, taskName: string): TaskJson {
  const today = new Date().toISOString().split("T")[0];
  return emptyTaskJson({
    id: taskName,
    name: taskName,
    title: `Joining: Onboard to this Trellis project (${developer})`,
    description:
      "Onboard a new developer to an existing Trellis project: learn the workflow, conventions, and find assigned work",
    status: "planning",
    dev_type: "docs",
    priority: "P1",
    creator: developer,
    assignee: developer,
    createdAt: today,
    meta: {
      classification: AUTO_ONBOARDING_CLASSIFICATION,
      product_intent: "NOT_REQUIRED",
      product_intent_reason: AUTO_ONBOARDING_PRODUCT_INTENT_REASON,
    },
    notes:
      "Generated by trellis init for a new developer joining an existing Trellis project",
  });
}

/**
 * PRD content for joiner onboarding. Kept concise (~80 lines) — deeper
 * guidance lives in skills and docs.
 */
function getJoinerPrdContent(developer: string, pythonCmd: string): string {
  const slug = slugifyDeveloperName(developer);
  return `# Joiner Onboarding Task

**You (the AI) are running this task. The developer does not read this file.**

\`${developer}\` just ran \`trellis init\` on a fresh clone, saw "Developer
initialized", and will now start asking you questions in chat. This joiner task
exists under \`.trellis/tasks/\`; when they want to work on it, they should
start it from a session that provides Trellis session identity.

Your job is to orient them to Trellis. Don't dump all of this at them — open
with a short greeting, ask where they want to start, and fill in the rest as
they engage.

---

## Goal

Orient ${developer} to this project's existing Trellis workflow and coding
specifications so they can begin assigned work without rewriting the baseline.

## Requirements

- Explain the natural-language workflow entry point and task lifecycle.
- Read and summarize the existing project specifications without editing them.
- Show the developer how to find archived-task examples and assigned work.
- Start a separate maintenance or product task for any newly discovered work;
  onboarding itself remains read-only with respect to project specifications.

## Acceptance Criteria

- [ ] ${developer} can describe how normal work enters the Trellis workflow.
- [ ] ${developer} knows where project specifications and task history live.
- [ ] Assigned work is identified, or the onboarding records that none exists.
- [ ] No project spec or product implementation was changed during onboarding.

---

## Onboarding boundary

This is a joiner flow, not creator bootstrap. The project already owns its
\`.trellis/spec/\` baseline. Read and summarize it; do not recreate, rewrite,
or bulk-copy general coding standards during onboarding. If you find a credible
project-spec gap, report the evidence and suggest a separate maintenance task.

## Topics to cover (adapt order to their questions)

### 1. What Trellis is + the workflow

Trellis is a workflow layer over Claude Code / Cursor / etc. that keeps AI
agents consistent with project-specific conventions instead of writing generic
code every session.

- **Three phases**: Plan (task basis and planning as needed) → Execute (code + check) →
  Finish (capture + wrap). Full reference: \`.trellis/workflow.md\`.
- **Task lifecycle**: planning → in_progress → done → archive, under
  \`.trellis/tasks/\`.
- **Normal entry point**: the developer describes the work in natural language;
  the agent uses the current workflow/task state to select the relevant skill
  and asks for confirmation where a gate requires it.
- **Explicit commands or skills** are optional controls for recovery,
  correction, standalone operations, or hosts without automatic routing. Do
  not teach a mandatory slash-command sequence.

### 2. Runtime mechanics (explain when they ask "how does it know what to do")

- Supported hosts expose session and workflow context through their available
  hook, skill, or startup mechanism. Consult \`.trellis/workflow.md\` for this
  project's authoritative routing.
- In sub-agent dispatch mode, implement/check workers receive curated task
  context from \`implement.jsonl\` / \`check.jsonl\` plus task artifacts.
- In inline mode, the main agent reads applicable specs and task artifacts
  directly and performs implementation/verification without mandatory worker
  spawning.

File layout (mention when they ask "where does what live"):
- \`.trellis/.runtime/sessions/<session>.json\` — session active-task state, gitignored
- \`.trellis/tasks/<task>/{implement,check}.jsonl\` — per-task context manifests
- \`.trellis/spec/\` — project-wide conventions (source of truth)
- \`.trellis/workspace/${developer}/journal-*.md\` — their session log,
  rotated at ~2000 lines

### 3. This project's actual conventions (read-only onboarding)

- Summarize \`.trellis/spec/\` for them — what coding conventions this
  specific team enforces. Do not edit those files as part of joiner onboarding.
- Point at the last 5 entries in \`.trellis/tasks/archive/\` as a rhythm
  example of how people actually work here. **If archive is empty** (the
  project just started), skip this — don't invent examples.
- Not your job in this onboarding to teach them the business code itself —
  the README and their teammates handle that.

### 4. Their assigned work

- Check if \`.trellis/workspace/${developer}/\` already exists — if yes, it's
  their journal from another machine and worth mentioning.
- Run \`${pythonCmd} ./.trellis/scripts/task.py list --assignee ${developer}\` to
  show tasks assigned to them. (Quote the name if it contains spaces.)
- Remind them that the "My Tasks" section appears in the SessionStart context
  on every new session.

---

## Optional: discuss a small task end-to-end

If they want to practice before touching real work, offer to pick a tiny
P3 task or a typo fix and describe how natural-language routing, the selected
execution mode, applicable verification, and completion would work. Start a
separate task only with their approval; onboarding itself does not require a
practice implementation.

---

## Completion

This task is intentionally created in \`planning\` status. Before doing the
onboarding work, activate it through the normal lifecycle and governance gate:

\`\`\`bash
${pythonCmd} ./.trellis/scripts/task.py start 00-join-${slug}
\`\`\`

When they feel oriented (or after you've covered the four topics with
reasonable back-and-forth), guide them to run:

\`\`\`bash
${pythonCmd} ./.trellis/scripts/task.py finish
${pythonCmd} ./.trellis/scripts/task.py archive 00-join-${slug}
\`\`\`

---

## Suggested opening line

"Welcome! Your \`trellis init\` set me up to onboard you to this project. I
can walk you through the workflow, show you the runtime mechanics under the
hood, summarize the team's spec, or jump to what you're already curious about
— which would you prefer?"
`;
}

/**
 * Create joiner onboarding task for a new developer on an existing Trellis
 * project. Task name is slugified to be filesystem-safe for arbitrary
 * developer names (spaces, Unicode, punctuation).
 */
function createJoinerOnboardingTask(
  cwd: string,
  developer: string,
  pythonCmd: string,
): boolean {
  const slug = slugifyDeveloperName(developer);
  const taskName = `00-join-${slug}`;
  const taskJson = getJoinerTaskJson(developer, taskName);
  const prdContent = getJoinerPrdContent(developer, pythonCmd);
  const intentContent = getAutoOnboardingTaskBasis(
    "joiner-onboarding",
    developer,
  );
  return writeTaskSkeleton(cwd, taskName, taskJson, prdContent, intentContent);
}

/**
 * Handle re-init when .trellis/ already exists.
 * Returns true if handled (caller should return), false if user chose full re-init.
 */
async function handleReinit(
  cwd: string,
  options: InitOptions,
  developerName: string | undefined,
  pythonCmd: string,
): Promise<boolean> {
  const TOOLS = getInitToolChoices();
  const configuredPlatforms = getConfiguredPlatforms(cwd);
  const configuredNames = [...configuredPlatforms]
    .map((id) => AI_TOOLS[id].name)
    .join(", ");

  // Determine explicit platform flags
  const explicitTools = TOOLS.filter(
    (t) => options[t.key as keyof InitOptions],
  ).map((t) => t.key);

  let doAddPlatforms = explicitTools.length > 0;
  let doAddDeveloper = !!options.user;
  let platformsToAdd: string[] = explicitTools;

  // No explicit flags → show menu
  if (!doAddPlatforms && !doAddDeveloper) {
    if (options.yes) {
      console.log(chalk.gray(`Already initialized with: ${configuredNames}`));
      console.log(
        chalk.gray(
          "Use platform flags (e.g., --codex) or -u <name> to add platforms/developer.",
        ),
      );
      return true;
    }

    console.log(
      chalk.gray(`\n   Already initialized with: ${configuredNames}\n`),
    );

    const { action } = await inquirer.prompt<{ action: string }>([
      {
        type: "list",
        name: "action",
        message: "Trellis is already initialized. What would you like to do?",
        choices: [
          { name: "Add AI platform(s)", value: "add-platform" },
          {
            name: "Set up developer identity on this device",
            value: "add-developer",
          },
          { name: "Full re-initialize", value: "full" },
        ],
      },
    ]);

    if (action === "full") {
      return false; // Fall through to full init
    }
    if (action === "add-platform") doAddPlatforms = true;
    if (action === "add-developer") doAddDeveloper = true;
  }

  // --- Add platforms ---
  if (doAddPlatforms) {
    if (platformsToAdd.length === 0) {
      // Interactive: show only unconfigured platforms
      const unconfigured = TOOLS.filter((t) => {
        const pid = resolveCliFlag(t.key);
        return pid && !configuredPlatforms.has(pid);
      });

      if (unconfigured.length === 0) {
        console.log(
          chalk.green("✓ All available platforms are already configured."),
        );
      } else {
        const answers = await inquirer.prompt<{ tools: string[] }>([
          {
            type: "checkbox",
            name: "tools",
            message: "Select platforms to add:",
            choices: unconfigured.map((t) => ({
              name: t.name,
              value: t.key,
            })),
          },
        ]);
        platformsToAdd = answers.tools;
      }
    }

    // Opt-in Claude Code statusLine: only for platforms actually being added
    // (already-configured ones are skipped in the loop below)
    await maybePromptStatuslineOptIn(
      options,
      platformsToAdd.filter((tool) => {
        const pid = resolveCliFlag(tool as CliFlag);
        return !!pid && !configuredPlatforms.has(pid);
      }),
    );

    const reinitWritten = startRecordingWrites(cwd);
    try {
      for (const tool of platformsToAdd) {
        const platformId = resolveCliFlag(tool as CliFlag);
        if (platformId) {
          if (configuredPlatforms.has(platformId)) {
            console.log(
              chalk.gray(
                `  ○ ${AI_TOOLS[platformId].name} already configured, skipping`,
              ),
            );
          } else {
            console.log(
              chalk.blue(`📝 Configuring ${AI_TOOLS[platformId].name}...`),
            );
            await configurePlatform(platformId, cwd, {
              withStatusline: options.withStatusline,
            });
            if (platformId === "claude-code" && options.withStatusline) {
              console.log(
                chalk.gray(
                  "   ↳ Trellis statusLine installed (--with-statusline)",
                ),
              );
            }
          }
        }
      }
    } finally {
      stopRecordingWrites();
    }

    // Update template hashes. Merge mode: preserve previously-tracked
    // platforms' hashes, layer in the newly-added platform's writes.
    const hashedCount = initializeHashes(cwd, {
      trackedPaths: reinitWritten,
      merge: true,
    });
    if (hashedCount > 0) {
      console.log(
        chalk.gray(`📋 Tracking ${hashedCount} template files for updates`),
      );
    }
  }

  // --- Add developer ---
  if (doAddDeveloper) {
    let devName = developerName;
    if (!devName) {
      devName = await askInput("Your name: ");
      while (!devName) {
        console.log(chalk.yellow("Name is required"));
        devName = await askInput("Your name: ");
      }
    }

    // Capture pre-init state: if .developer did not exist before we ran
    // init_developer.py, this checkout had no identity → treat as a new
    // joiner onboarding onto an existing Trellis project.
    const hadDeveloperFileBefore = fs.existsSync(
      path.join(cwd, DIR_NAMES.WORKFLOW, FILE_NAMES.DEVELOPER),
    );

    try {
      const scriptPath = path.join(cwd, PATHS.SCRIPTS, "init_developer.py");
      execSync(`${pythonCmd} "${scriptPath}" "${devName}"`, {
        cwd,
        stdio: "pipe",
      });
      console.log(chalk.green(`✓ Developer "${devName}" initialized`));
    } catch {
      console.log(
        chalk.yellow("⚠ Could not initialize developer. Run manually:"),
      );
      console.log(
        chalk.gray(
          `  ${pythonCmd} .trellis/scripts/init_developer.py ${devName}`,
        ),
      );
    }

    // Create joiner onboarding task for fresh checkouts (no prior .developer).
    // Runs outside the init_developer try/catch so failures surface as warnings.
    if (!hadDeveloperFileBefore) {
      try {
        if (!createJoinerOnboardingTask(cwd, devName, pythonCmd)) {
          console.warn(
            chalk.yellow("⚠ Failed to create joiner onboarding task"),
          );
        }
      } catch (err) {
        console.warn(
          chalk.yellow(
            `⚠ Joiner onboarding setup failed: ${err instanceof Error ? err.message : String(err)}`,
          ),
        );
      }
    }
  }

  return true;
}

/**
 * Interactive opt-in for the Claude Code statusLine when `--with-statusline`
 * was not passed. Fires only when Claude Code is among the platforms about to
 * be configured and never in -y mode. Mutates `options.withStatusline` so the
 * configurePlatform call sites and the install hint read the same answer; the
 * `!== undefined` gate doubles as the asked-once-per-run guard.
 */
async function maybePromptStatuslineOptIn(
  options: InitOptions,
  toolKeys: string[],
): Promise<void> {
  if (options.yes || options.withStatusline !== undefined) return;
  if (!toolKeys.includes(AI_TOOLS["claude-code"].cliFlag)) return;

  const answer = await inquirer.prompt<{ withStatusline: boolean }>([
    {
      type: "confirm",
      name: "withStatusline",
      message:
        "Install Trellis statusLine for Claude Code? (status bar: model, context, branch, rate limits)",
      default: false,
    },
  ]);
  options.withStatusline = answer.withStatusline;
}

interface InitOptions {
  cursor?: boolean;
  claude?: boolean;
  opencode?: boolean;
  codex?: boolean;
  kilo?: boolean;
  kiro?: boolean;
  gemini?: boolean;
  antigravity?: boolean;
  devin?: boolean;
  /** Deprecated alias for `devin` — Windsurf was renamed to Devin. */
  windsurf?: boolean;
  qoder?: boolean;
  codebuddy?: boolean;
  copilot?: boolean;
  droid?: boolean;
  pi?: boolean;
  reasonix?: boolean;
  zcode?: boolean;
  trae?: boolean;
  omp?: boolean;
  grok?: boolean;
  kimi?: boolean;
  snow?: boolean;
  yes?: boolean;
  user?: string;
  force?: boolean;
  skipExisting?: boolean;
  template?: string;
  overwrite?: boolean;
  append?: boolean;
  registry?: string;
  monorepo?: boolean;
  /** Claude Code only: install the opt-in Trellis statusLine (--with-statusline) */
  withStatusline?: boolean;
  workflow?: string;
  workflowSource?: string;
}

// Compile-time check: every CliFlag must be a key of InitOptions.
// If a new platform is added to CliFlag but not to InitOptions, this line errors.
// Uses [X] extends [Y] to prevent distributive conditional behavior.
type _AssertCliFlagsInOptions = [CliFlag] extends [keyof InitOptions]
  ? true
  : "ERROR: CliFlag has values not present in InitOptions";
const _cliFlagCheck: _AssertCliFlagsInOptions = true;

/**
 * Write monorepo package configuration to config.yaml (non-destructive patch).
 * Appends packages: and default_package: without disturbing existing config.
 */
function writeMonorepoConfig(cwd: string, packages: DetectedPackage[]): void {
  const configPath = path.join(cwd, DIR_NAMES.WORKFLOW, "config.yaml");
  let content = "";

  try {
    content = fs.readFileSync(configPath, "utf-8");
  } catch {
    // Config not created yet; will be created by createWorkflowStructure
    return;
  }

  // Don't overwrite if packages: already exists (re-init case)
  if (/^packages\s*:/m.test(content)) {
    return;
  }

  const lines = ["\n# Auto-detected monorepo packages", "packages:"];
  for (const pkg of packages) {
    lines.push(`  ${sanitizePkgName(pkg.name)}:`);
    lines.push(`    path: ${pkg.path}`);
    if (pkg.isSubmodule) {
      lines.push("    type: submodule");
    } else if (pkg.isGitRepo) {
      lines.push("    git: true");
    }
  }

  // Use first non-submodule package as default, fallback to first package
  const defaultPkg =
    packages.find((p) => !p.isSubmodule)?.name ?? packages[0]?.name;
  if (defaultPkg) {
    lines.push(`default_package: ${defaultPkg}`);
  }

  fs.writeFileSync(
    configPath,
    content.trimEnd() + "\n" + lines.join("\n") + "\n",
    "utf-8",
  );
}

interface InitAnswers {
  tools: string[];
  template?: string;
  existingDirAction?: TemplateStrategy;
}

export async function init(options: InitOptions): Promise<void> {
  // Refuse to run in $HOME — running here would scoop platform runtime data
  // (Claude/Codex/OpenCode session histories etc.) into the trellis hash
  // manifest, and a subsequent `trellis uninstall` would wipe it.
  if (isCwdHomedir() && !homedirBypassEnabled()) {
    console.error(chalk.red(homedirGuardMessage("init")));
    process.exit(1);
  }

  // Deprecated alias: --windsurf → --devin (Windsurf was renamed to Devin).
  // Normalize here too so programmatic callers (not just the CLI action) map
  // correctly. The CLI action prints the deprecation notice.
  if (options.windsurf) {
    options.devin = true;
    delete options.windsurf;
  }

  const cwd = process.cwd();
  const isFirstInit = !fs.existsSync(path.join(cwd, DIR_NAMES.WORKFLOW));
  const hadSpecBaselineAtStart = !isFirstInit && hasMeaningfulSpecBaseline(cwd);
  // Captured here (before createWorkflowStructure + init_developer run) so
  // the three-branch dispatch at the bottom can tell "fresh clone joiner"
  // (.trellis/ exists, .developer missing) apart from "creator first init".
  const hadDeveloperFileAtStart = fs.existsSync(
    path.join(cwd, DIR_NAMES.WORKFLOW, FILE_NAMES.DEVELOPER),
  );

  // Generate ASCII art banner dynamically using FIGlet "Rebel" font
  const banner = figlet.textSync("Trellis", { font: "Rebel" });
  console.log(chalk.cyan(`\n${banner.trimEnd()}`));
  console.log(
    chalk.gray(
      "\n   All-in-one AI framework & toolkit for Claude Code & Cursor\n",
    ),
  );

  // Set up proxy before any network calls
  const proxyUrl = setupProxy();
  if (proxyUrl) {
    console.log(chalk.gray(`   Using proxy: ${maskProxyUrl(proxyUrl)}\n`));
  }

  // Set write mode based on options
  let writeMode: WriteMode = "ask";
  if (options.force) {
    writeMode = "force";
    console.log(chalk.gray("Mode: Force overwrite existing files\n"));
  } else if (options.skipExisting) {
    writeMode = "skip";
    console.log(chalk.gray("Mode: Skip existing files\n"));
  } else if (options.yes) {
    // -y implies non-interactive: never prompt on conflicts. Default to skip
    // (preserve user files) — explicit --force is required to overwrite.
    writeMode = "skip";
    console.log(chalk.gray("Mode: Non-interactive (skip existing files)\n"));
  }
  setWriteMode(writeMode);

  // Detect developer name from git config or options
  let developerName = options.user;
  if (!developerName) {
    // Only detect from git if current directory is a git repo
    const isGitRepo = fs.existsSync(path.join(cwd, ".git"));
    if (isGitRepo) {
      try {
        developerName = execSync("git config user.name", {
          cwd,
          encoding: "utf-8",
        }).trim();
      } catch {
        // Git not available or no user.name configured
      }
    }
  }

  if (developerName) {
    console.log(chalk.blue("👤 Developer:"), chalk.gray(developerName));
  }

  const { command: pythonCmd } = resolveSupportedPython();

  // ==========================================================================
  // Re-init fast path: skip full flow when .trellis/ already exists
  // ==========================================================================

  // Aborted-init recovery (issue #204): if .trellis/ exists but tasks/ is
  // empty, the previous init never reached bootstrap creation. Fall through
  // to the full flow so the main-dispatch tasksEmpty fallback fires —
  // handleReinit's joiner branch would otherwise mis-route the recovery.
  const tasksDirEarly = path.join(cwd, PATHS.TASKS);
  const tasksEmptyEarly =
    !fs.existsSync(tasksDirEarly) || fs.readdirSync(tasksDirEarly).length === 0;
  const hasTemplateRequest = !!options.template || !!options.registry;

  if (
    !isFirstInit &&
    !options.force &&
    !options.skipExisting &&
    !tasksEmptyEarly &&
    hadSpecBaselineAtStart &&
    !hasTemplateRequest
  ) {
    const reinitDone = await handleReinit(
      cwd,
      options,
      developerName,
      pythonCmd,
    );
    if (reinitDone) return;
    // reinitDone === false means user chose "full re-initialize" → fall through
  }

  if (!developerName && !options.yes) {
    // Ask for developer name if not detected and not in yes mode
    console.log(
      chalk.gray(
        "\nTrellis supports team collaboration - each developer has their own\n" +
          `workspace directory (${PATHS.WORKSPACE}/{name}/) to track AI sessions.\n` +
          "Tip: Usually this is your git username (git config user.name).\n",
      ),
    );
    developerName = await askInput("Your name: ");
    while (!developerName) {
      console.log(chalk.yellow("Name is required"));
      developerName = await askInput("Your name: ");
    }
    console.log(chalk.blue("👤 Developer:"), chalk.gray(developerName));
  }

  // Detect project type (silent - no output)
  const detectedType = detectProjectType(cwd);

  // Parse custom registry source early (needed by both monorepo + single-repo flows)
  let registry: RegistrySource | undefined;
  let registrySourceForConfig: string | undefined;
  if (options.registry) {
    try {
      registry = parseRegistrySource(options.registry);
      registrySourceForConfig = options.registry;
    } catch (error) {
      console.log(
        chalk.red(
          error instanceof Error ? error.message : "Invalid registry source",
        ),
      );
      return;
    }
  }

  // Determine template strategy from flags (needed before monorepo template downloads)
  let templateStrategy: TemplateStrategy = "skip";
  if (options.overwrite) {
    templateStrategy = "overwrite";
  } else if (options.append) {
    templateStrategy = "append";
  }

  // ==========================================================================
  // Monorepo Detection
  // ==========================================================================

  let monorepoPackages: DetectedPackage[] | undefined;
  let remoteSpecPackages: Set<string> | undefined;

  if (options.monorepo !== false) {
    // options.monorepo: true = --monorepo, false = --no-monorepo, undefined = auto
    const detected = detectMonorepo(cwd);

    if (options.monorepo === true && !detected) {
      console.log(
        chalk.red(
          "Error: --monorepo specified but no multi-package layout detected.",
        ),
      );
      console.log("");
      console.log(chalk.gray("Checked:"));
      console.log(chalk.gray("  ✗ pnpm-workspace.yaml"));
      console.log(chalk.gray("  ✗ package.json workspaces"));
      console.log(chalk.gray("  ✗ Cargo.toml [workspace]"));
      console.log(chalk.gray("  ✗ go.work"));
      console.log(chalk.gray("  ✗ pyproject.toml [tool.uv.workspace]"));
      console.log(chalk.gray("  ✗ .gitmodules"));
      console.log(chalk.gray("  ✗ sibling .git directories (need ≥ 2)"));
      console.log("");
      console.log("To configure manually, add to .trellis/config.yaml:");
      console.log("");
      console.log(chalk.cyan("  packages:"));
      console.log(chalk.cyan("    frontend:"));
      console.log(chalk.cyan("      path: ./frontend"));
      console.log(chalk.cyan("      git: true       # if it has its own .git"));
      console.log(chalk.cyan("    backend:"));
      console.log(chalk.cyan("      path: ./backend"));
      console.log(chalk.cyan("      git: true"));
      return;
    }

    if (detected && detected.length > 0) {
      let enableMonorepo = false;

      if (options.monorepo === true || options.yes) {
        enableMonorepo = true;
      } else {
        // Show detected packages and ask
        console.log(chalk.blue("\n🔍 Detected monorepo packages:"));
        for (const pkg of detected) {
          const tag = pkg.isSubmodule
            ? chalk.gray(" (submodule)")
            : pkg.isGitRepo
              ? chalk.gray(" (git repo)")
              : "";
          console.log(
            chalk.gray(`   - ${pkg.name}`) +
              chalk.gray(` (${pkg.path})`) +
              chalk.gray(` [${pkg.type}]`) +
              tag,
          );
        }
        console.log("");

        const { useMonorepo } = await inquirer.prompt<{
          useMonorepo: boolean;
        }>([
          {
            type: "confirm",
            name: "useMonorepo",
            message: "Enable monorepo mode?",
            default: true,
          },
        ]);
        enableMonorepo = useMonorepo;
      }

      if (enableMonorepo) {
        monorepoPackages = detected;
        remoteSpecPackages = new Set<string>();

        // Per-package template selection (unless -y mode: all use blank spec)
        if (!options.yes && !options.template) {
          for (const pkg of detected) {
            const { specSource } = await inquirer.prompt<{
              specSource: string;
            }>([
              {
                type: "list",
                name: "specSource",
                message: `Spec source for ${pkg.name} (${pkg.path}):`,
                choices: [
                  { name: "From scratch (Trellis default)", value: "blank" },
                  { name: "Download remote template", value: "remote" },
                ],
                default: "blank",
              },
            ]);

            if (specSource === "remote") {
              // Use existing template download flow, targeting spec/<name>/
              const destDir = path.join(
                cwd,
                PATHS.SPEC,
                sanitizePkgName(pkg.name),
              );
              console.log(chalk.blue(`📦 Select template for ${pkg.name}...`));
              // Fetch templates if not already done
              const templates = await fetchTemplateIndex();
              const specTemplates = templates
                .filter((t) => t.type === "spec")
                .map((t) => ({
                  name: `${t.id} (${t.name})`,
                  value: t.id,
                }));

              if (specTemplates.length > 0) {
                const { templateId } = await inquirer.prompt<{
                  templateId: string;
                }>([
                  {
                    type: "list",
                    name: "templateId",
                    message: `Select template for ${pkg.name}:`,
                    choices: specTemplates,
                  },
                ]);

                const result = await downloadTemplateById(
                  cwd,
                  templateId,
                  templateStrategy,
                  templates.find((t) => t.id === templateId),
                  undefined,
                  destDir,
                );

                if (result.success) {
                  console.log(chalk.green(`   ${result.message}`));
                  remoteSpecPackages.add(sanitizePkgName(pkg.name));
                } else {
                  console.log(chalk.yellow(`   ${result.message}`));
                  console.log(chalk.gray("   Falling back to blank spec..."));
                }
              } else {
                console.log(
                  chalk.gray("   No templates available. Using blank spec."),
                );
              }
            }
          }
        } else if (options.template) {
          // --template as default for all packages
          for (const pkg of detected) {
            const destDir = path.join(
              cwd,
              PATHS.SPEC,
              sanitizePkgName(pkg.name),
            );
            const result = await downloadTemplateById(
              cwd,
              options.template,
              templateStrategy,
              undefined,
              registry,
              destDir,
            );
            if (result.success && !result.skipped) {
              remoteSpecPackages.add(sanitizePkgName(pkg.name));
            }
          }
        }
      }
    }
  }

  // Tool definitions derived from platform registry
  const TOOLS = getInitToolChoices();

  // Build tools from explicit flags
  const explicitTools = TOOLS.filter(
    (t) => options[t.key as keyof InitOptions],
  ).map((t) => t.key);

  let tools: string[];

  if (explicitTools.length > 0) {
    // Explicit flags take precedence (works with or without -y)
    tools = explicitTools;
  } else if (options.yes) {
    // No explicit tools + -y: default to Cursor and Claude
    tools = TOOLS.filter((t) => t.defaultChecked).map((t) => t.key);
  } else {
    // Interactive mode
    const answers = await inquirer.prompt<InitAnswers>([
      {
        type: "checkbox",
        name: "tools",
        message: "Select AI tools to configure:",
        choices: TOOLS.map((t) => ({
          name: t.name,
          value: t.key,
          checked: t.defaultChecked,
        })),
      },
    ]);
    tools = answers.tools;
  }

  // Treat unknown project type as fullstack
  const projectType: ProjectType =
    detectedType === "unknown" ? "fullstack" : detectedType;

  if (tools.length === 0) {
    console.log(
      chalk.yellow("No tools selected. At least one tool is required."),
    );
    return;
  }

  // Opt-in Claude Code statusLine: confirm interactively when the flag wasn't passed
  await maybePromptStatuslineOptIn(options, tools);

  // ==========================================================================
  // Template Selection (single-repo only; monorepo handles templates above)
  // ==========================================================================

  let selectedTemplate: string | null = null;

  // Pre-fetched templates list (used to pass selected SpecTemplate to downloadTemplateById)
  let fetchedTemplates: SpecTemplate[] = [];
  let registryBackend: RegistryBackend | undefined;

  // Determine the index URL based on registry
  const indexUrl = registry
    ? `${registry.rawBaseUrl}/index.json`
    : TEMPLATE_INDEX_URL;

  if (monorepoPackages) {
    // Monorepo: template selection already handled above
  } else if (options.template) {
    // Template specified via --template flag
    selectedTemplate = options.template;
    if (registry) {
      const probeResult = await probeRegistryIndex(indexUrl, registry);
      registryBackend = probeResult.backend;
      if (probeResult.error) {
        console.log(chalk.red(`Error: ${probeResult.error.message}`));
        return;
      }
      if (probeResult.isNotFound) {
        console.log(
          chalk.red(
            "Error: Registry has no index.json. Remove --template to use direct download mode.",
          ),
        );
        return;
      }
      fetchedTemplates = probeResult.templates;
    }
  } else if (!options.yes) {
    // Interactive mode: show template selection
    const timeoutSec = TIMEOUTS.INDEX_FETCH_MS / 1000;
    const sourceLabel = registry ? registry.gigetSource : TEMPLATE_INDEX_URL;
    console.log(
      chalk.gray(`   Fetching available templates from ${sourceLabel}`),
    );
    let elapsed = 0;
    const ticker = setInterval(() => {
      elapsed++;
      process.stdout.write(
        `\r${chalk.gray(`   Loading... ${elapsed}s/${timeoutSec}s`)}`,
      );
    }, 1000);
    process.stdout.write(chalk.gray(`   Loading... 0s/${timeoutSec}s`));
    let templates: SpecTemplate[];
    let registryProbeNotFound = false;
    let registryProbeError: Error | undefined;
    if (registry) {
      const probeResult = await probeRegistryIndex(indexUrl, registry);
      templates = probeResult.templates;
      registryProbeNotFound = probeResult.isNotFound;
      registryProbeError = probeResult.error;
      registryBackend = probeResult.backend;
    } else {
      templates = await fetchTemplateIndex(indexUrl);
    }
    clearInterval(ticker);
    // Clear the loading line
    process.stdout.write("\r\x1b[2K");
    fetchedTemplates = templates;

    if (templates.length === 0 && registry && registryProbeNotFound) {
      // Custom registry: confirmed no index.json — will try direct download later
      console.log(
        chalk.gray(
          "   No index.json found at registry. Will download as direct spec template.",
        ),
      );
    } else if (templates.length === 0 && registry) {
      // Custom registry: transient error (not a 404) — abort, don't misclassify
      console.log(
        chalk.red(
          `   ${registryProbeError?.message ?? "Could not reach registry. Check your connection and try again."}`,
        ),
      );
      return;
    } else if (templates.length === 0) {
      console.log(
        chalk.gray(
          "   Could not fetch templates (offline or server unavailable).",
        ),
      );
      console.log(chalk.gray("   Using blank templates.\n"));
    }

    if (templates.length > 0) {
      // Build template choices
      const specTemplates = templates
        .filter((t) => t.type === "spec")
        .map((t) => ({
          name: `${t.id} (${t.name})`,
          value: t.id,
        }));

      const templateChoices = registry
        ? specTemplates
        : [
            {
              name: "from scratch (default)",
              value: "blank",
            },
            ...specTemplates,
            {
              name: "custom (enter a registry source)",
              value: "__custom__",
            },
          ];

      // Loop to allow returning from custom source input back to the picker
      let templatePicked = false;
      while (templateChoices.length > 0 && !templatePicked) {
        const templateAnswer = await inquirer.prompt<{ template: string }>([
          {
            type: "list",
            name: "template",
            message: "Select a spec template:",
            choices: templateChoices,
            default: registry ? undefined : "blank",
          },
        ]);

        if (templateAnswer.template === "__custom__") {
          // Prompt for custom registry source (empty → back to picker)
          const customSource = await askInput(
            "Enter registry source (e.g., gh:myorg/myrepo/specs), or press Enter to go back: ",
          );
          if (!customSource) {
            continue; // Back to picker
          }
          try {
            registry = parseRegistrySource(customSource);
            registrySourceForConfig = customSource;
            fetchedTemplates = []; // Reset so direct-download guard works correctly
            // Probe index.json to detect marketplace vs direct download
            const customIndexUrl = `${registry.rawBaseUrl}/index.json`;
            console.log(
              chalk.gray(
                `   Checking for templates at ${registry.gigetSource}...`,
              ),
            );
            const customProbe = await probeRegistryIndex(
              customIndexUrl,
              registry,
            );
            const customTemplates = customProbe.templates;
            registryBackend = customProbe.backend;
            if (customTemplates.length > 0) {
              // Marketplace mode: show picker with custom templates
              fetchedTemplates = customTemplates;
              const customChoices = customTemplates
                .filter((t) => t.type === "spec")
                .map((t) => ({
                  name: `${t.id} (${t.name})`,
                  value: t.id,
                }));
              if (customChoices.length > 0) {
                const customAnswer = await inquirer.prompt<{
                  template: string;
                }>([
                  {
                    type: "list",
                    name: "template",
                    message: "Select a spec template:",
                    choices: customChoices,
                  },
                ]);
                selectedTemplate = customAnswer.template;

                // Check if spec directory already exists and ask what to do
                const specDir = path.join(cwd, PATHS.SPEC);
                if (
                  fs.existsSync(specDir) &&
                  !options.overwrite &&
                  !options.append
                ) {
                  const actionAnswer = await inquirer.prompt<{
                    action: TemplateStrategy;
                  }>([
                    {
                      type: "list",
                      name: "action",
                      message: `Directory ${PATHS.SPEC} already exists. What do you want to do?`,
                      choices: [
                        { name: "Skip (keep existing)", value: "skip" },
                        {
                          name: "Overwrite (replace all)",
                          value: "overwrite",
                        },
                        {
                          name: "Append (add missing files only)",
                          value: "append",
                        },
                      ],
                      default: "skip",
                    },
                  ]);
                  templateStrategy = actionAnswer.action;
                }
              }
              templatePicked = true;
            } else if (customProbe.isNotFound) {
              // No index.json → direct download mode
              templatePicked = true;
            } else {
              // Transient error (not 404) — loop back, don't misclassify
              console.log(
                chalk.yellow(
                  `   ${customProbe.error?.message ?? "Could not reach registry. Try again or enter a different source."}`,
                ),
              );
              registry = undefined; // Reset so we don't fall through to direct download
              registrySourceForConfig = undefined;
            }
          } catch (error) {
            console.log(
              chalk.red(
                error instanceof Error
                  ? error.message
                  : "Invalid registry source",
              ),
            );
            // Loop back to picker
          }
        } else {
          templatePicked = true;
          if (templateAnswer.template !== "blank") {
            selectedTemplate = templateAnswer.template;

            // Check if spec directory already exists and ask what to do
            const specDir = path.join(cwd, PATHS.SPEC);
            if (
              fs.existsSync(specDir) &&
              !options.overwrite &&
              !options.append
            ) {
              const actionAnswer = await inquirer.prompt<{
                action: TemplateStrategy;
              }>([
                {
                  type: "list",
                  name: "action",
                  message: `Directory ${PATHS.SPEC} already exists. What do you want to do?`,
                  choices: [
                    { name: "Skip (keep existing)", value: "skip" },
                    { name: "Overwrite (replace all)", value: "overwrite" },
                    {
                      name: "Append (add missing files only)",
                      value: "append",
                    },
                  ],
                  default: "skip",
                },
              ]);
              templateStrategy = actionAnswer.action;
            }
          }
        }
      }
    }
  }
  // -y mode with --registry (no --template): probe index.json to detect mode
  // Skip when monorepo mode already handled templates above
  if (options.yes && registry && !selectedTemplate && !monorepoPackages) {
    const probeResult = await probeRegistryIndex(
      `${registry.rawBaseUrl}/index.json`,
      registry,
    );
    registryBackend = probeResult.backend;
    if (probeResult.templates.length > 0) {
      // Marketplace mode requires interactive selection — can't auto-select
      console.log(
        chalk.red(
          "Error: Registry is a marketplace with multiple templates. " +
            "Use --template <id> to specify which one, or remove -y for interactive selection.",
        ),
      );
      return;
    }
    if (!probeResult.isNotFound) {
      // Transient error (not 404) — abort, don't misclassify as direct-download
      console.log(
        chalk.red(
          `Error: ${probeResult.error?.message ?? "Could not reach registry. Check your connection and try again."}`,
        ),
      );
      return;
    }
    // isNotFound=true → no index.json, proceed with direct download (fetchedTemplates stays empty)
  }

  // ==========================================================================
  // Download Remote Template (if selected or direct registry download)
  // ==========================================================================

  let useRemoteTemplate = false;
  let registrySpecConfigToPersist: SpecRegistryConfig | null = null;

  if (selectedTemplate) {
    // Marketplace mode: download specific template by ID
    console.log(chalk.blue(`📦 Downloading template "${selectedTemplate}"...`));
    console.log(chalk.gray("   This may take a moment on slow connections."));

    // Find pre-fetched SpecTemplate to avoid double-fetch
    const prefetched = fetchedTemplates.find((t) => t.id === selectedTemplate);

    const result = await downloadTemplateById(
      cwd,
      selectedTemplate,
      templateStrategy,
      prefetched,
      registry,
      undefined,
      registryBackend,
    );

    if (result.success) {
      if (result.skipped) {
        console.log(chalk.gray(`   ${result.message}`));
      } else {
        console.log(chalk.green(`   ${result.message}`));
        useRemoteTemplate = true;
        if (registry) {
          registrySpecConfigToPersist = {
            source: registrySourceForConfig ?? registry.gigetSource,
            template: selectedTemplate,
          };
        }
      }
    } else {
      console.log(chalk.yellow(`   ${result.message}`));
      console.log(chalk.gray("   Falling back to blank templates..."));
      const retryCmd = registry
        ? `trellis init --registry ${registry.gigetSource} --template ${selectedTemplate}`
        : `trellis init --template ${selectedTemplate}`;
      console.log(chalk.gray(`   You can retry later: ${retryCmd}`));
    }
  } else if (registry && fetchedTemplates.length === 0) {
    // Direct download mode: registry has no index.json, download directory directly
    console.log(
      chalk.blue(`📦 Downloading spec from ${registry.gigetSource}...`),
    );
    console.log(chalk.gray("   This may take a moment on slow connections."));

    // Ask about existing spec dir in interactive mode
    if (!options.yes && !options.overwrite && !options.append) {
      const specDir = path.join(cwd, PATHS.SPEC);
      if (fs.existsSync(specDir)) {
        const actionAnswer = await inquirer.prompt<{
          action: TemplateStrategy;
        }>([
          {
            type: "list",
            name: "action",
            message: `Directory ${PATHS.SPEC} already exists. What do you want to do?`,
            choices: [
              { name: "Skip (keep existing)", value: "skip" },
              { name: "Overwrite (replace all)", value: "overwrite" },
              { name: "Append (add missing files only)", value: "append" },
            ],
            default: "skip",
          },
        ]);
        templateStrategy = actionAnswer.action;
      }
    }

    const result = await downloadRegistryDirect(
      cwd,
      registry,
      templateStrategy,
      undefined,
      registryBackend,
    );

    if (result.success) {
      if (result.skipped) {
        console.log(chalk.gray(`   ${result.message}`));
      } else {
        console.log(chalk.green(`   ${result.message}`));
        useRemoteTemplate = true;
        registrySpecConfigToPersist = {
          source: registrySourceForConfig ?? registry.gigetSource,
        };
      }
    } else {
      console.log(chalk.yellow(`   ${result.message}`));
      console.log(chalk.gray("   Falling back to blank templates..."));
      console.log(
        chalk.gray(
          `   You can retry later: trellis init --registry ${registry.gigetSource}`,
        ),
      );
    }
  }

  // ==========================================================================
  // Resolve workflow template (default: native bundled)
  // ==========================================================================

  const workflowIdInput = options.workflow?.trim();
  const workflowId =
    workflowIdInput && workflowIdInput.length > 0
      ? workflowIdInput
      : NATIVE_WORKFLOW_ID;
  let workflowMdOverride: string | undefined;
  if (workflowId !== NATIVE_WORKFLOW_ID || options.workflowSource) {
    const resolved = await resolveWorkflowTemplate(workflowId, {
      source: options.workflowSource,
    });
    if (resolved.id !== NATIVE_WORKFLOW_ID) {
      workflowMdOverride = resolved.content;
      console.log(
        chalk.blue(`🧭 Using workflow template: ${chalk.cyan(resolved.id)}`),
      );
    }
  }

  // ==========================================================================
  // Create Workflow Structure
  // ==========================================================================

  // Record every successful write from here through createRootFiles. The
  // captured set is the source of truth for `.template-hashes.json`'s
  // platform/root entries — replacing the previous "walk every managed dir"
  // approach that swept user-owned runtime files into the manifest
  // (.codex/sessions/, .claude/projects/, pre-existing AGENTS.md).
  const writtenPaths = startRecordingWrites(cwd);
  try {
    // Create workflow structure with project type
    console.log(chalk.blue("📁 Creating workflow structure..."));
    await createWorkflowStructure(cwd, {
      projectType,
      skipSpecTemplates: useRemoteTemplate,
      packages: monorepoPackages,
      remoteSpecPackages,
      workflowMdOverride,
    });

    // Write monorepo packages to config.yaml (non-destructive patch)
    if (monorepoPackages) {
      writeMonorepoConfig(cwd, monorepoPackages);
      console.log(chalk.blue("📦 Monorepo packages written to config.yaml"));
    }

    // Write version file for update tracking
    const versionPath = path.join(cwd, DIR_NAMES.WORKFLOW, ".version");
    fs.writeFileSync(versionPath, VERSION);

    // Configure selected tools by copying entire directories (dogfooding)
    for (const tool of tools) {
      const platformId = resolveCliFlag(tool);
      if (platformId) {
        console.log(
          chalk.blue(`📝 Configuring ${AI_TOOLS[platformId].name}...`),
        );
        await configurePlatform(platformId, cwd, {
          withStatusline: options.withStatusline,
        });
        if (platformId === "claude-code" && options.withStatusline) {
          console.log(
            chalk.gray("   ↳ Trellis statusLine installed (--with-statusline)"),
          );
        }
      }
    }

    const pythonPlatforms = getPlatformsWithPythonHooks();
    const hasSelectedPythonPlatform = pythonPlatforms.some((id) =>
      tools.includes(AI_TOOLS[id].cliFlag),
    );
    if (hasSelectedPythonPlatform) {
      logPythonAdaptationNotice(pythonCmd);
    }

    // Create root files (skip if exists)
    await createRootFiles(cwd);
  } finally {
    stopRecordingWrites();
  }

  if (registrySpecConfigToPersist) {
    writeSpecRegistryConfig(cwd, registrySpecConfigToPersist);
  }

  // Initialize template hashes for modification tracking. A full re-init of
  // an existing checkout may skip byte-identical platform files, so its write
  // recorder is intentionally incomplete. Preserve the checkout's existing
  // ownership entries in that case; only a true first init starts a manifest
  // from scratch.
  const hashedCount = initializeHashes(cwd, {
    trackedPaths: writtenPaths,
    merge: !isFirstInit,
  });
  if (useRemoteTemplate) {
    const specFilesToHash = new Map<string, string>();
    for (const relativePath of collectSpecPaths(cwd)) {
      const content = fs.readFileSync(path.join(cwd, relativePath), "utf-8");
      specFilesToHash.set(relativePath, content);
    }
    if (specFilesToHash.size > 0) {
      updateHashes(cwd, specFilesToHash);
    }
  }
  if (hashedCount > 0) {
    console.log(
      chalk.gray(`📋 Tracking ${hashedCount} template files for updates`),
    );
  }

  // Non-native workflow is user-managed local content. Drop the
  // `.trellis/workflow.md` hash entry so `trellis update` classifies it as
  // modified and does not silently restore native bytes. See design.md
  // "Durable-state contract".
  if (workflowMdOverride !== undefined && workflowId !== NATIVE_WORKFLOW_ID) {
    removeHash(cwd, PATHS.WORKFLOW_GUIDE_FILE);
  }

  // Initialize developer identity (silent - no output)
  if (developerName) {
    try {
      const scriptPath = path.join(cwd, PATHS.SCRIPTS, "init_developer.py");
      execSync(`${pythonCmd} "${scriptPath}" "${developerName}"`, {
        cwd,
        stdio: "pipe", // Silent
      });
    } catch {
      // Silent failure - user can run init_developer.py manually
    }

    // Three-branch dispatch using flags captured at init() start (before
    // createWorkflowStructure/init_developer ran, so they reflect the disk
    // state of the user's checkout, not the state this init just produced):
    //   isFirstInit=true                       → creator bootstrap (new project)
    //   isFirstInit=false + no .developer file → joiner onboarding (fresh clone)
    //   isFirstInit=false + .developer exists  → same-dev re-init, no task
    //
    // Tasks-empty fallback (issue #204): if .trellis/ exists but tasks dir is
    // empty, the previous init aborted before creating the bootstrap task. Run
    // bootstrap creation regardless of isFirstInit. writeTaskSkeleton is
    // idempotent so repeated triggers are safe.
    //
    // Runs OUTSIDE the init_developer try/catch (which uses stdio: "pipe")
    // so joiner failures surface as warnings instead of being silently
    // swallowed.
    const tasksDir = path.join(cwd, PATHS.TASKS);
    const tasksEmpty =
      !fs.existsSync(tasksDir) || fs.readdirSync(tasksDir).length === 0;

    if (isFirstInit || tasksEmpty || !hadSpecBaselineAtStart) {
      const persistedSpecRegistry = loadSpecRegistryConfig(cwd);
      const loadedSpecSource = persistedSpecRegistry
        ? persistedSpecRegistry.template
          ? `${persistedSpecRegistry.source} (template: ${persistedSpecRegistry.template})`
          : persistedSpecRegistry.source
        : remoteSpecPackages && remoteSpecPackages.size > 0
          ? `remote templates for ${[...remoteSpecPackages].join(", ")}`
          : useRemoteTemplate
            ? selectedTemplate
              ? `template: ${selectedTemplate}`
              : "remote spec template"
            : undefined;
      const specPaths = [...collectSpecPaths(cwd)].sort();
      const specSourceLoaded =
        useRemoteTemplate ||
        (remoteSpecPackages !== undefined && remoteSpecPackages.size > 0);

      createBootstrapTask(
        cwd,
        developerName,
        pythonCmd,
        projectType,
        monorepoPackages,
        loadedSpecSource,
        specSourceLoaded,
        specPaths,
      );
    } else if (!hadDeveloperFileAtStart) {
      try {
        if (!createJoinerOnboardingTask(cwd, developerName, pythonCmd)) {
          console.warn(
            chalk.yellow("⚠ Failed to create joiner onboarding task"),
          );
        }
      } catch (err) {
        console.warn(
          chalk.yellow(
            `⚠ Joiner onboarding setup failed: ${err instanceof Error ? err.message : String(err)}`,
          ),
        );
      }
    }
  }
}

/**
 * Simple readline-based input (no flickering like inquirer)
 */
function askInput(prompt: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function createRootFiles(cwd: string): Promise<void> {
  const agentsPath = path.join(cwd, FILE_NAMES.AGENTS);

  // Write AGENTS.md from template
  const agentsWritten = await writeFile(agentsPath, agentsMdContent);
  if (agentsWritten) {
    console.log(chalk.blue("📄 Created AGENTS.md"));
  }
}
