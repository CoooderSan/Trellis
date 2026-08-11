import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../../..");
const templateRoot = path.join(repoRoot, "packages", "cli", "src", "templates");

function readRepo(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf-8");
}

function readTemplate(relativePath: string): string {
  return fs.readFileSync(path.join(templateRoot, relativePath), "utf-8");
}

function listTemplateFiles(root: string): string[] {
  const files: string[] = [];

  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...listTemplateFiles(entryPath));
    } else if (entry.isFile()) {
      files.push(entryPath);
    }
  }

  return files;
}

describe("classified workflow routing parity", () => {
  it("keeps Dazz presentation scoped to classified Trellis constraints", () => {
    const start = readTemplate("common/commands/start.md");
    const brainstorm = readTemplate("common/skills/brainstorm.md");
    const beforeDev = readTemplate("common/skills/before-dev.md");
    const workflow = readTemplate("trellis/workflow.md");
    const check = readTemplate("common/skills/check.md");

    for (const [relativePath, content] of [
      ["common/commands/start.md", start],
      ["common/skills/brainstorm.md", brainstorm],
      ["common/skills/before-dev.md", beforeDev],
      ["trellis/workflow.md", workflow],
    ]) {
      expect(content, relativePath).toContain("Dazz");
      expect(content, relativePath).toMatch(
        /single concrete (action|next action)/,
      );
    }

    expect(workflow).toContain(
      "Dazz is a presentation layer for Trellis-owned reminders, teaching, corrections, and hard stops",
    );
    expect(workflow).toContain(
      "Keep ordinary research, progress, and quality reporting natural",
    );
    expect(workflow).toContain(
      "Readonly and ordinary operational work remain outside development gates",
    );
    expect(workflow).toContain(
      "Never recreate a blanket Product Intent requirement",
    );
    expect(brainstorm).toContain(
      "A business feature without approved Product Intent must stop before task creation",
    );
    expect(brainstorm).toContain(
      "A bugfix or maintenance task may use `NOT_REQUIRED`",
    );
    expect(beforeDev).toContain(
      "eligible bugfix/maintenance work may use a complete Task Basis",
    );
    expect(check).not.toContain("Dazz");
  });

  it("keeps generated Claude and Codex Dazz guidance aligned with common sources", () => {
    const outputs = [
      ".claude/skills/trellis-brainstorm/SKILL.md",
      ".claude/skills/trellis-before-dev/SKILL.md",
      ".agents/skills/trellis-start/SKILL.md",
      ".agents/skills/trellis-brainstorm/SKILL.md",
      ".agents/skills/trellis-before-dev/SKILL.md",
    ];

    for (const relativePath of outputs) {
      const content = readRepo(relativePath);
      expect(content, relativePath).toContain("Dazz");
      expect(content, relativePath).toContain("Trellis-owned");
      expect(content, relativePath).not.toMatch(/\{\{[^}]+\}\}/);
    }

    for (const relativePath of [
      ".claude/skills/trellis-brainstorm/SKILL.md",
      ".agents/skills/trellis-brainstorm/SKILL.md",
    ]) {
      const content = readRepo(relativePath);
      expect(content, relativePath).toContain(
        "A business feature without approved Product Intent must stop before task creation",
      );
      expect(content, relativePath).toContain(
        "A bugfix or maintenance task may use `NOT_REQUIRED`",
      );
      expect(content, relativePath).toContain(
        "never apply the development gate to readonly or ordinary operational work",
      );
    }
  });

  it("keeps no-active-task session hooks natural-language-first", () => {
    const sources = [
      "shared-hooks/session-start.py",
      "codex/hooks/session-start.py",
      "copilot/hooks/session-start.py",
      "opencode/lib/session-utils.js",
    ];

    for (const relativePath of sources) {
      const content = readTemplate(relativePath);
      expect(content, relativePath).toContain(
        "Read-only questions and ordinary",
      );
      expect(content, relativePath).toContain(
        "operational work normally proceed without a development task",
      );
      expect(content, relativePath).toContain("review revisions");
      expect(content, relativePath).toContain(
        "reuse their existing task and review evidence",
      );
      expect(content, relativePath).not.toContain(
        "Simple conversation / small task asks only whether this turn should create a Trellis task",
      );
    }
  });

  it("keeps tracked session-hook outputs aligned with their template sources", () => {
    const outputs = [
      ".claude/hooks/session-start.py",
      ".cursor/hooks/session-start.py",
      ".codex/hooks/session-start.py",
      ".opencode/lib/session-utils.js",
    ];

    for (const relativePath of outputs) {
      const content = readRepo(relativePath);
      expect(content, relativePath).toContain(
        "Read-only questions and ordinary",
      );
      expect(content, relativePath).toContain(
        "operational work normally proceed without a development task",
      );
      expect(content, relativePath).toContain("review revisions");
      expect(content, relativePath).toContain(
        "reuse their existing task and review evidence",
      );
      expect(content, relativePath).not.toContain(
        "Simple conversation / small task asks only whether this turn should create a Trellis task",
      );
    }
  });

  it("documents natural-language routing in manual start fallbacks", () => {
    const source = readTemplate("common/commands/start.md");
    const outputs = [
      ".agents/skills/trellis-start/SKILL.md",
      ".opencode/commands/trellis/start.md",
      ".pi/prompts/trellis-start.md",
    ];

    expect(source).toContain(
      "Natural-language intent is the default workflow entry",
    );
    expect(source).toContain(
      "Read-only questions and ordinary operational work normally proceed without a development task",
    );
    for (const relativePath of outputs) {
      const content = readRepo(relativePath);
      expect(content, relativePath).toContain(
        "Natural-language intent is the default workflow entry",
      );
      expect(content, relativePath).toContain(
        "Read-only questions and ordinary operational work normally proceed without a development task",
      );
    }
  });

  it("requires classified Task Basis examples in task-system documentation", () => {
    const sourcePath =
      "common/bundled-skills/trellis-meta/references/local-architecture/task-system.md";
    const content = readTemplate(sourcePath);

    expect(content).toContain("| `intent.md` | Structured Task Basis");
    expect(content).toContain(
      "Every parent and child owns its own classification and Task Basis",
    );
    expect(content).toContain("--classification business-feature");
    expect(content).toContain("--product-intent-link");
    expect(content).toContain("--classification maintenance");
    expect(content).toContain("--product-intent-reason");
    expect(content).toContain("Inline execution does not require JSONL");
    expect(content).toContain("validate-role-context");
  });

  it("keeps every copyable task create invocation classified", () => {
    const violations: string[] = [];
    const surfaces = [
      ...listTemplateFiles(templateRoot).map((filePath) => ({
        filePath,
        label: path.relative(templateRoot, filePath),
      })),
      {
        filePath: path.join(repoRoot, ".trellis", "scripts", "task.py"),
        label: ".trellis/scripts/task.py",
      },
    ];

    for (const { filePath, label } of surfaces) {
      const lines = fs.readFileSync(filePath, "utf-8").split("\n");

      lines.forEach((line, index) => {
        if (
          !/(?:python3|\{\{PYTHON_CMD\}\})\s+(?:\.\/\.trellis\/scripts\/)?task\.py create\s+/.test(
            line,
          )
        ) {
          return;
        }

        const hasClassification = line.includes("--classification");
        const hasIntentEvidence =
          line.includes("--product-intent-link") ||
          line.includes("--product-intent-reason");
        if (!hasClassification || !hasIntentEvidence) {
          violations.push(`${label}:${index + 1}: ${line.trim()}`);
        }
      });
    }

    expect(violations).toEqual([]);
  });

  it("keeps common and Copilot brainstorm entry contracts classified", () => {
    for (const relativePath of [
      "common/skills/brainstorm.md",
      "copilot/prompts/brainstorm.prompt.md",
    ]) {
      const content = readTemplate(relativePath);
      expect(content, relativePath).toContain(
        "Natural-language development requests are the normal trigger",
      );
      expect(content, relativePath).toContain(
        "--classification business-feature",
      );
      expect(content, relativePath).toContain("--product-intent-link");
      expect(content, relativePath).toContain(
        "--classification <bugfix-or-maintenance>",
      );
      expect(content, relativePath).toContain("--product-intent-reason");
      expect(content, relativePath).toContain("Treat TDD as optional");
      expect(
        content.match(/Plan a risk-appropriate verification strategy/g),
      ).toHaveLength(1);
    }
  });
});
