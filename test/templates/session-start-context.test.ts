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
    ".trellis/workflow.md": [
      "# Workflow",
      "",
      "## Session Start Process",
      "",
      "## Development Process",
      "",
      "## Session End",
      "",
    ].join("\n"),
    ".trellis/scripts/get_context.py":
      "import sys\nif '--mode' in sys.argv:\n    print('{\"mode\": \"single\"}')\nelse:\n    print('SESSION CONTEXT')\n",
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

function runPythonSessionStart(
  scriptPath: string,
  projectDir: string,
  env: NodeJS.ProcessEnv,
) {
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
    expect(
      nextIndex,
      `"${needle}" should appear after previous entry`,
    ).toBeGreaterThan(lastIndex);
    lastIndex = nextIndex;
  }
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("session-start spec context injection", () => {
  it("Claude and iFlow hooks inject workflow indexes, guideline indexes, and task status", () => {
    const projectDir = createProject({
      "frontend/index.md": "# Frontend Index\n- read frontend/rules.md\n",
      "frontend/rules.md": "# Frontend Rules\n",
      "ecochain/index.md": "# Ecochain Package\n- read ecochain/common/index.md\n",
      "ecochain/common/index.md": "# Ecochain Common\n- read common/start-session.md\n",
      "ecochain/common/start-session.md": "# Start Session Rule\n",
      "guides/index.md": "# Guides Index\n",
    });

    for (const [label, scriptPath, env] of [
      [
        "Claude",
        CLAUDE_HOOK,
        { ...process.env, CLAUDE_PROJECT_DIR: projectDir },
      ],
      [
        "iFlow",
        IFLOW_HOOK,
        { ...process.env, IFLOW_PROJECT_DIR: projectDir },
      ],
    ] as const) {
      const context = runPythonSessionStart(scriptPath, projectDir, env);
      expect(context).toContain("<workflow>");
      expect(context).toContain("# Development Workflow — Section Index");
      expect(context).toContain("Full guide: .trellis/workflow.md (read on demand)");
      expect(context).toContain("## Session Start Process");
      expect(context).toContain("## Development Process");
      expect(context).toContain("<guidelines>");
      expect(context).toContain(
        "These are guideline indexes only. Read the specific files they reference before implementation.",
      );
      expect(context).toContain("## guides");
      expect(context).toContain("# Guides Index");
      expect(context).toContain("## ecochain");
      expect(context).toContain("# Ecochain Package");
      expect(context).toContain("## ecochain/common");
      expect(context).toContain("# Ecochain Common");
      expect(context).toContain("## frontend");
      expect(context).toContain("# Frontend Index");
      expect(context).toContain("<task-status>");
      expect(context).toContain("Status: NO ACTIVE TASK");
      expect(context).not.toContain("### ecochain/common/start-session.md");
      expect(context).not.toContain("# Start Session Rule");
      expect(context).not.toContain("# Frontend Rules");
      expect(context).not.toContain("<instructions>");
      expect(context).not.toContain("[Spec context truncated");

      expectInOrder(context, [
        "## guides",
        "# Guides Index",
        "## ecochain",
        "# Ecochain Package",
        "## ecochain/common",
        "# Ecochain Common",
        "## frontend",
        "# Frontend Index",
      ]);

      expect(context, `${label} should inject ready marker`).toContain("<ready>");
    }
  });

  it("Claude and iFlow hooks keep namespaced package indexes even when spec_scope narrows monorepo packages", () => {
    const projectDir = createProject(
      {
        "ecochain/index.md": "# Ecochain Package\n",
        "ecochain/common/index.md": "# Ecochain Common\n",
        "pkg-a/backend/index.md": "# PkgA Backend\n",
        "pkg-a/frontend/index.md": "# PkgA Frontend\n",
        "pkg-b/backend/index.md": "# PkgB Backend\n",
        "guides/index.md": "# Guides Index\n",
      },
      {
        ".trellis/scripts/common/__init__.py": "",
        ".trellis/scripts/common/config.py": [
          "from pathlib import Path",
          "",
          "def is_monorepo(_root: Path):",
          "    return True",
          "",
          "def get_packages(_root: Path):",
          "    return {'pkg-a': {}, 'pkg-b': {}}",
          "",
          "def get_spec_scope(_root: Path):",
          "    return ['pkg-a']",
          "",
          "def get_default_package(_root: Path):",
          "    return 'pkg-a'",
          "",
        ].join("\n"),
        ".trellis/scripts/common/paths.py": [
          "def get_current_task(_root):",
          "    return None",
          "",
        ].join("\n"),
        ".trellis/scripts/get_context.py": [
          "import json",
          "import sys",
          "if '--mode' in sys.argv:",
          "    print(json.dumps({",
          "        'mode': 'monorepo',",
          "        'packages': [{'name': 'pkg-a'}, {'name': 'pkg-b'}],",
          "        'specScope': ['pkg-a'],",
          "        'activeTaskPackage': None,",
          "        'defaultPackage': 'pkg-a',",
          "    }))",
          "else:",
          "    print('SESSION CONTEXT')",
          "",
        ].join("\n"),
      },
    );

    for (const [scriptPath, env] of [
      [CLAUDE_HOOK, { ...process.env, CLAUDE_PROJECT_DIR: projectDir }],
      [IFLOW_HOOK, { ...process.env, IFLOW_PROJECT_DIR: projectDir }],
    ] as const) {
      const context = runPythonSessionStart(scriptPath, projectDir, env);
      expect(context).toContain("## guides");
      expect(context).toContain("## ecochain");
      expect(context).toContain("## ecochain/common");
      expect(context).toContain("## pkg-a/backend");
      expect(context).toContain("## pkg-a/frontend");
      expect(context).not.toContain("## pkg-b/backend");
    }
  });

  it("Claude and iFlow hooks include persisted session gate summary when available", () => {
    const projectDir = createProject(
      {
        "frontend/index.md": "# Frontend Index\n",
      },
      {
        ".trellis/scripts/session_gate.py": [
          "import json",
          "import sys",
          "if sys.argv[1:] == ['show', '--json']:",
          "    print(json.dumps({",
          "        'status': 'blocked',",
          "        'taskType': 'brainstorm',",
          "        'request': 'Add inventory sync',",
          "        'summary': 'Need intent first',",
          "        'applicableDocs': ['.trellis/spec/ecochain/index.md'],",
          "        'blockers': ['Intent missing'],",
          "        'nextStep': 'Write intent',",
          "        'updatedAt': '2026-04-19T09:00:00Z',",
          "    }))",
          "",
        ].join("\n"),
      },
    );

    for (const [scriptPath, env] of [
      [CLAUDE_HOOK, { ...process.env, CLAUDE_PROJECT_DIR: projectDir }],
      [IFLOW_HOOK, { ...process.env, IFLOW_PROJECT_DIR: projectDir }],
    ] as const) {
      const context = runPythonSessionStart(scriptPath, projectDir, env);
      expect(context).toContain("<session-gate>");
      expect(context).toContain("Status: BLOCKED");
      expect(context).toContain("Task type: brainstorm");
      expect(context).toContain("Request: Add inventory sync");
      expect(context).toContain("Summary: Need intent first");
      expect(context).toContain("Docs:");
      expect(context).toContain("- .trellis/spec/ecochain/index.md");
      expect(context).toContain("Blockers:");
      expect(context).toContain("- Intent missing");
      expect(context).toContain("Next: Write intent");
      expect(context).toContain("Updated: 2026-04-19T09:00:00Z");
    }
  });

  it("Claude hook reports active task readiness in task-status", () => {
    const projectDir = createProject(
      {
        "frontend/index.md": "# Frontend Index\n",
      },
      {
        ".trellis/.current-task": "demo-task\n",
        ".trellis/tasks/demo-task/prd.md": "# PRD\n",
        ".trellis/tasks/demo-task/spec.jsonl":
          '{"file":".trellis/spec/frontend/index.md"}\n',
        ".trellis/tasks/demo-task/task.json": JSON.stringify({
          title: "Demo Task",
          status: "in_progress",
        }),
      },
    );

    const context = runPythonSessionStart(CLAUDE_HOOK, projectDir, {
      ...process.env,
      CLAUDE_PROJECT_DIR: projectDir,
    });

    expect(context).toContain("<task-status>");
    expect(context).toContain("Status: READY");
    expect(context).toContain("Task: Demo Task");
    expect(context).toContain("Next: Continue with implement or check");
  });

  it("OpenCode plugin prepends workflow indexes, guideline indexes, gate summary, and task status to the first user message", async () => {
    const projectDir = createProject(
      {
        "frontend/index.md": "# Frontend Index\n",
        "frontend/forms/index.md": "# Forms Index\n",
        "team-guides/index.md": "# Team Guides\n",
        "team-guides/rules.md": "# Team Guide Rules\n",
      },
      {
        ".trellis/scripts/session_gate.py": [
          "import json",
          "import sys",
          "if sys.argv[1:] == ['show', '--json']:",
          "    print(json.dumps({",
          "        'status': 'ready',",
          "        'taskType': 'simple',",
          "        'request': 'Continue work',",
          "        'summary': 'No blockers',",
          "        'nextStep': 'Classify the task',",
          "        'updatedAt': '2026-04-19T10:00:00Z',",
          "    }))",
          "",
        ].join("\n"),
      },
    );

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
      expect(text).toContain("<workflow>");
      expect(text).toContain("# Development Workflow — Section Index");
      expect(text).toContain("<guidelines>");
      expect(text).toContain("## team-guides");
      expect(text).toContain("# Team Guides");
      expect(text).toContain("## frontend");
      expect(text).toContain("# Frontend Index");
      expect(text).toContain("## frontend/forms");
      expect(text).toContain("# Forms Index");
      expect(text).toContain("<session-gate>");
      expect(text).toContain("Status: READY");
      expect(text).toContain("Task type: simple");
      expect(text).toContain("Summary: No blockers");
      expect(text).toContain("<task-status>");
      expect(text).toContain("Status: NO ACTIVE TASK");
      expect(text).not.toContain("<instructions>");
      expect(text).not.toContain("# Team Guide Rules");
      expect(text).toContain("\n\n---\n\nContinue work");

      expectInOrder(text, [
        "<session-context>",
        "<current-state>",
        "<session-gate>",
        "<workflow>",
        "<guidelines>",
        "## frontend",
        "# Frontend Index",
        "## frontend/forms",
        "# Forms Index",
        "## team-guides",
        "# Team Guides",
        "<task-status>",
        "<ready>",
      ]);
    } finally {
      process.env.HOME = previousHome;
    }
  });
});
