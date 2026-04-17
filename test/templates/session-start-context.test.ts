import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import sessionStartPlugin from "../../src/templates/opencode/plugin/session-start.js";

const CLAUDE_HOOK = join(
  process.cwd(),
  "src/templates/claude/hooks/session-start.py",
);
const IFLOW_HOOK = join(
  process.cwd(),
  "src/templates/iflow/hooks/session-start.py",
);

const tempDirs: string[] = [];

function createProject(
  specFiles: Record<string, string>,
  extraFiles: Record<string, string> = {},
) {
  const projectDir = mkdtempSync(join(tmpdir(), "trellis-session-start-"));
  tempDirs.push(projectDir);

  const files = {
    ".trellis/workflow.md": "# Workflow\n",
    ".trellis/scripts/get_context.py": "print('SESSION CONTEXT')\n",
    ".claude/commands/trellis/start.md": "# Claude Start\n",
    ".iflow/commands/trellis/start.md": "# iFlow Start\n",
    ".opencode/commands/trellis/start.md": "# OpenCode Start\n",
    ...Object.fromEntries(
      Object.entries(specFiles).map(([path, content]) => [
        join(".trellis/spec", path),
        content,
      ]),
    ),
    ...extraFiles,
  };

  for (const [relativePath, content] of Object.entries(files)) {
    const fullPath = join(projectDir, relativePath);
    mkdirSync(join(fullPath, ".."), { recursive: true });
    writeFileSync(fullPath, content, "utf-8");
  }

  return projectDir;
}

function runPythonSessionStart(scriptPath: string, projectDir: string, env: NodeJS.ProcessEnv) {
  const raw = execFileSync("python3", [scriptPath], {
    cwd: projectDir,
    env,
    encoding: "utf-8",
  });
  const parsed = JSON.parse(raw) as {
    hookSpecificOutput: { additionalContext: string };
  };
  return parsed.hookSpecificOutput.additionalContext;
}

function expectInOrder(haystack: string, needles: string[]) {
  let lastIndex = -1;
  for (const needle of needles) {
    const nextIndex = haystack.indexOf(needle);
    expect(nextIndex, `missing "${needle}"`).toBeGreaterThanOrEqual(0);
    expect(nextIndex, `"${needle}" should appear after previous entry`).toBeGreaterThan(lastIndex);
    lastIndex = nextIndex;
  }
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("session-start spec context injection", () => {
  it("Claude and iFlow hooks recursively load nested spec files in stable order", () => {
    const projectDir = createProject(
      {
        "root.md": "# Root\n",
        "frontend/index.md": "# Frontend\n",
        "frontend/button.md": "# Button\n",
        "frontend/nested/index.md": "# Nested Frontend\n",
        "frontend/nested/rules.md": "# Nested Rules\n",
        "backend/index.md": "# Backend\n",
        "guides/index.md": "# Guides\n",
        "governance/index.md": "# Governance\n",
        "testing/index.md": "# Testing\n",
        "zzz-custom/index.md": "# Custom\n",
        ".hidden/ignored.md": "# Hidden\n",
        "backend/.secret.md": "# Secret\n",
      },
      {
        ".trellis/spec/frontend/.ignored-dir/rule.md": "# Ignore Dir\n",
      },
    );

    for (const [label, scriptPath, env] of [
      [
        "Claude",
        CLAUDE_HOOK,
        { ...process.env, CLAUDE_PROJECT_DIR: projectDir },
      ],
      ["iFlow", IFLOW_HOOK, { ...process.env }],
    ] as const) {
      const context = runPythonSessionStart(scriptPath, projectDir, env);
      expect(context).toContain("<guidelines>");
      expect(context).toContain("### root.md");
      expect(context).toContain("## Frontend");
      expect(context).toContain("## Backend");
      expect(context).toContain("## Guides");
      expect(context).toContain("## Governance");
      expect(context).toContain("## Testing");
      expect(context).toContain("## Zzz Custom");
      expect(context).not.toContain("ignored.md");
      expect(context).not.toContain(".secret.md");
      expect(context).not.toContain(".ignored-dir");

      expectInOrder(context, [
        "### root.md",
        "## Frontend",
        "### frontend/index.md",
        "### frontend/button.md",
        "### frontend/nested/index.md",
        "### frontend/nested/rules.md",
        "## Backend",
        "### backend/index.md",
        "## Guides",
        "### guides/index.md",
        "## Governance",
        "### governance/index.md",
        "## Testing",
        "### testing/index.md",
        "## Zzz Custom",
        "### zzz-custom/index.md",
      ]);

      expect(context, `${label} should include start instructions`).toContain(
        "<instructions>",
      );
    }
  });

  it("Claude hook truncates nested spec injection after the file limit", () => {
    const specFiles = Object.fromEntries(
      Array.from({ length: 41 }, (_, index) => [
        `frontend/spec-${String(index).padStart(2, "0")}.md`,
        `# Spec ${index}\n`,
      ]),
    );
    const projectDir = createProject(specFiles);

    const context = runPythonSessionStart(CLAUDE_HOOK, projectDir, {
      ...process.env,
      CLAUDE_PROJECT_DIR: projectDir,
    });

    expect(context).toContain(
      "[Spec context truncated after 40 files",
    );
    expect(context).toContain("### frontend/spec-39.md");
    expect(context).not.toContain("### frontend/spec-40.md");
  });

  it("OpenCode plugin prepends recursively loaded spec context to the first user message", async () => {
    const projectDir = createProject({
      "frontend/index.md": "# Frontend\n",
      "frontend/forms/index.md": "# Forms\n",
      "backend/index.md": "# Backend\n",
      "team-guides/index.md": "# Team Guides\n",
      ".hidden/ignored.md": "# Hidden\n",
    });

    const previousHome = process.env.HOME;
    const isolatedHome = mkdtempSync(join(tmpdir(), "trellis-opencode-home-"));
    tempDirs.push(isolatedHome);
    process.env.HOME = isolatedHome;

    try {
      const plugin = await sessionStartPlugin({ directory: projectDir });
      await plugin["chat.message"]({
        sessionID: "session-1",
        agent: "test",
      });

      const output = {
        messages: [
          {
            info: { role: "user", sessionID: "session-1" },
            parts: [{ type: "text", text: "Continue work" }],
          },
        ],
      };

      await plugin["experimental.chat.messages.transform"]({}, output);

      const text = output.messages[0].parts[0].text;
      expect(text).toContain("<guidelines>");
      expect(text).toContain("## Frontend");
      expect(text).toContain("### frontend/forms/index.md");
      expect(text).toContain("## Backend");
      expect(text).toContain("## Team Guides");
      expect(text).not.toContain("ignored.md");
      expect(text).toContain("\n\n---\n\nContinue work");

      expectInOrder(text, [
        "## Frontend",
        "### frontend/index.md",
        "### frontend/forms/index.md",
        "## Backend",
        "### backend/index.md",
        "## Team Guides",
        "### team-guides/index.md",
      ]);
    } finally {
      process.env.HOME = previousHome;
    }
  });
});
