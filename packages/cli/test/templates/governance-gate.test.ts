import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { getAllScripts } from "../../src/templates/trellis/index.js";

const tempDirs: string[] = [];

function writeFile(path: string, content: string): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content, "utf-8");
}

function createProject(enabled = true, command?: string): string {
  const projectDir = mkdtempSync(join(tmpdir(), "trellis-governance-gate-"));
  tempDirs.push(projectDir);
  for (const [relativePath, content] of getAllScripts()) {
    writeFile(join(projectDir, ".trellis", "scripts", relativePath), content);
  }
  writeFile(join(projectDir, ".trellis", ".developer"), "name=agent\n");
  const configLines = [
    "governance:",
    `  enabled: ${enabled ? "true" : "false"}`,
    "  enforce:",
    "    task_create: true",
    "    task_start: true",
  ];
  if (command) configLines.push(`  command: ${JSON.stringify(command)}`);
  writeFile(
    join(projectDir, ".trellis", "config.yaml"),
    [...configLines, ""].join("\n"),
  );
  return projectDir;
}

function createProjectWithEvaluator(source: string): string {
  const projectDir = createProject(true, "python3 evaluator.py");
  writeFile(join(projectDir, "evaluator.py"), source);
  return projectDir;
}

function runTask(projectDir: string, args: string[]) {
  return spawnSync("python3", [".trellis/scripts/task.py", ...args], {
    cwd: projectDir,
    encoding: "utf-8",
  });
}

function taskDirs(projectDir: string): string[] {
  const root = join(projectDir, ".trellis", "tasks");
  if (!existsSync(root)) return [];
  return readdirSync(root).filter((entry) => entry !== "archive");
}

function completeTaskBasis(
  projectDir: string,
  taskDir: string,
  classification: string,
  productIntent: string[],
): void {
  writeFile(
    join(projectDir, taskDir, "intent.md"),
    [
      "# Task Basis",
      "",
      "## Classification",
      "",
      classification,
      "",
      "## Product Intent",
      "",
      ...productIntent,
      "",
      "## Requested Outcome",
      "",
      "Deliver the requested behavior with a reviewable result.",
      "",
      "## In Scope / Out of Scope",
      "",
      "- In scope: the requested behavior.",
      "- Out of scope: unrelated product work.",
      "",
      "## Acceptance or Verification Basis",
      "",
      "- Run the repository-native focused checks.",
      "",
    ].join("\n"),
  );
  writeFile(
    join(projectDir, taskDir, "prd.md"),
    [
      "# Planned change",
      "",
      "## Goal",
      "Deliver the requested behavior.",
      "",
      "## Requirements",
      "- Preserve existing behavior outside scope.",
      "",
      "## Acceptance Criteria",
      "- [ ] Repository-native verification passes.",
      "",
    ].join("\n"),
  );
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("classified governance gate", () => {
  it.each(["readonly", "operational"])(
    "does not create a development task for %s work",
    (classification) => {
      const projectDir = createProject();
      const result = runTask(projectDir, [
        "create",
        "Inspect repository",
        "--slug",
        "inspect",
        "--classification",
        classification,
      ]);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("do not create a development task");
      expect(taskDirs(projectDir)).toEqual([]);
    },
  );

  it("blocks a business feature before task creation without Product Intent", () => {
    const projectDir = createProject();
    const result = runTask(projectDir, [
      "create",
      "Add checkout capability",
      "--slug",
      "checkout",
      "--classification",
      "business-feature",
    ]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("requires approved Product Intent");
    expect(taskDirs(projectDir)).toEqual([]);
  });

  it("enables classified governance when config omits the governance section", () => {
    const projectDir = createProject();
    writeFile(
      join(projectDir, ".trellis", "config.yaml"),
      "session_auto_commit: false\n",
    );

    const result = runTask(projectDir, [
      "create",
      "Add checkout capability",
      "--slug",
      "default-on-checkout",
      "--classification",
      "business-feature",
    ]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("requires approved Product Intent");
    expect(taskDirs(projectDir)).toEqual([]);
  });

  it("creates and starts a business feature with linked Product Intent and Task Basis", () => {
    const projectDir = createProject();
    const createResult = runTask(projectDir, [
      "create",
      "Add checkout capability",
      "--slug",
      "checkout",
      "--classification",
      "business-feature",
      "--product-intent-link",
      "https://kb.example/product-intent/checkout",
      "--no-start",
    ]);
    expect(createResult.status).toBe(0);
    const taskDir = createResult.stdout.trim();
    completeTaskBasis(projectDir, taskDir, "business-feature", [
      "Status: LINKED",
      "Link: https://kb.example/product-intent/checkout",
      "Reason: Approved product direction.",
    ]);

    const startResult = runTask(projectDir, ["start", taskDir]);
    expect(startResult.status).toBe(0);
  });

  it("allows bugfix creation but blocks start until NOT_REQUIRED has a reason", () => {
    const projectDir = createProject();
    const createResult = runTask(projectDir, [
      "create",
      "Fix stale cache",
      "--slug",
      "stale-cache",
      "--classification",
      "bugfix",
      "--no-start",
    ]);
    expect(createResult.status).toBe(0);
    const taskDir = createResult.stdout.trim();

    const startResult = runTask(projectDir, ["start", taskDir]);
    expect(startResult.status).toBe(1);
    expect(startResult.stderr).toContain(
      "Product Intent NOT_REQUIRED requires a concrete Reason",
    );
  });

  it("starts a bugfix with NOT_REQUIRED and a complete lightweight Task Basis", () => {
    const projectDir = createProject();
    const createResult = runTask(projectDir, [
      "create",
      "Fix stale cache",
      "--slug",
      "stale-cache-ready",
      "--classification",
      "bugfix",
      "--product-intent-reason",
      "Reproduction: a cache entry remains stale after invalidation; this corrects existing behavior without changing product direction.",
      "--no-start",
    ]);
    expect(createResult.status).toBe(0);
    const taskDir = createResult.stdout.trim();
    completeTaskBasis(projectDir, taskDir, "bugfix", [
      "Status: NOT_REQUIRED",
      "Link:",
      "Reason: Reproduction: a cache entry remains stale after invalidation; this corrects existing behavior without changing product direction.",
    ]);

    expect(runTask(projectDir, ["start", taskDir]).status).toBe(0);
  });

  it("starts maintenance with a complete lightweight Task Basis", () => {
    const projectDir = createProject();
    const createResult = runTask(projectDir, [
      "create",
      "Refresh dependency",
      "--slug",
      "dependency",
      "--classification",
      "maintenance",
      "--product-intent-reason",
      "Engineering dependency maintenance without product behavior changes.",
      "--no-start",
    ]);
    expect(createResult.status).toBe(0);
    const taskDir = createResult.stdout.trim();
    completeTaskBasis(projectDir, taskDir, "maintenance", [
      "Status: NOT_REQUIRED",
      "Link:",
      "Reason: Engineering dependency maintenance without product behavior changes.",
    ]);

    expect(runTask(projectDir, ["start", taskDir]).status).toBe(0);
  });

  it.each([
    [
      "Classification",
      (content: string) =>
        content.replace(
          "\nmaintenance\n\n## Product Intent",
          "\n\n## Product Intent",
        ),
      "Task Basis has no supported ## Classification",
    ],
    [
      "Product Intent Status",
      (content: string) => content.replace("Status: NOT_REQUIRED", "Status:"),
      "maintenance Task Basis must explicitly declare Product Intent Status: NOT_REQUIRED",
    ],
    [
      "Product Intent Reason",
      (content: string) =>
        content.replace("Reason: Engineering-only maintenance.", "Reason:"),
      "Product Intent NOT_REQUIRED requires a concrete Reason",
    ],
    [
      "Requested Outcome",
      (content: string) =>
        content.replace(
          "Deliver the requested behavior with a reviewable result.",
          "",
        ),
      "Task Basis section is missing or incomplete: ## Requested Outcome",
    ],
    [
      "In Scope / Out of Scope",
      (content: string) =>
        content.replace(
          "- In scope: the requested behavior.\n- Out of scope: unrelated product work.",
          "",
        ),
      "Task Basis section is missing or incomplete: ## In Scope Out Of Scope",
    ],
    [
      "Acceptance or Verification Basis",
      (content: string) =>
        content.replace("- Run the repository-native focused checks.", ""),
      "Task Basis section is missing or incomplete: ## Acceptance Or Verification Basis",
    ],
  ])(
    "blocks maintenance start when required Task Basis field %s is missing",
    (_field, removeField, expected) => {
      const projectDir = createProject();
      const createResult = runTask(projectDir, [
        "create",
        "Refresh dependency",
        "--slug",
        `maintenance-missing-${String(_field)
          .toLowerCase()
          .replaceAll(/[^a-z]+/g, "-")}`,
        "--classification",
        "maintenance",
        "--product-intent-reason",
        "Engineering-only maintenance.",
        "--no-start",
      ]);
      expect(createResult.status).toBe(0);
      const taskDir = createResult.stdout.trim();
      completeTaskBasis(projectDir, taskDir, "maintenance", [
        "Status: NOT_REQUIRED",
        "Link:",
        "Reason: Engineering-only maintenance.",
      ]);
      const intentPath = join(projectDir, taskDir, "intent.md");
      writeFile(intentPath, removeField(readFileSync(intentPath, "utf-8")));

      const result = runTask(projectDir, ["start", taskDir]);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(expected);
    },
  );

  it("keeps mixed-platform Codex inline start independent from JSONL manifests", () => {
    const projectDir = createProject();
    mkdirSync(join(projectDir, ".codex"), { recursive: true });
    mkdirSync(join(projectDir, ".claude"), { recursive: true });
    writeFile(
      join(projectDir, ".trellis", "config.yaml"),
      [
        "governance:",
        "  enabled: true",
        "  enforce:",
        "    task_create: true",
        "    task_start: true",
        "codex:",
        "  dispatch_mode: inline",
        "",
      ].join("\n"),
    );
    const createResult = runTask(projectDir, [
      "create",
      "Refresh dependency",
      "--slug",
      "codex-inline-no-jsonl",
      "--classification",
      "maintenance",
      "--product-intent-reason",
      "Engineering-only maintenance.",
      "--no-start",
    ]);
    expect(createResult.status).toBe(0);
    const taskDir = createResult.stdout.trim();
    completeTaskBasis(projectDir, taskDir, "maintenance", [
      "Status: NOT_REQUIRED",
      "Link:",
      "Reason: Engineering-only maintenance.",
    ]);
    expect(existsSync(join(projectDir, taskDir, "implement.jsonl"))).toBe(true);
    expect(existsSync(join(projectDir, taskDir, "check.jsonl"))).toBe(true);
    rmSync(join(projectDir, taskDir, "implement.jsonl"), { force: true });
    rmSync(join(projectDir, taskDir, "check.jsonl"), { force: true });

    expect(runTask(projectDir, ["start", taskDir]).status).toBe(0);
  });

  it.each([
    ["missing", undefined, "manifest is missing"],
    ["empty", "", "manifest is empty"],
    [
      "seed-only",
      `${JSON.stringify({ _example: "curate a real entry" })}\n`,
      "seed rows do not count",
    ],
    ["malformed", "{not-json\n", "invalid JSON"],
    [
      "invalid entry",
      `${JSON.stringify({ file: 42, reason: "wrong type" })}\n`,
      "non-empty string field 'file'",
    ],
  ])(
    "validate-role-context blocks an %s implement manifest",
    (_name, content, expected) => {
      const projectDir = createProject(false);
      const taskDir = ".trellis/tasks/01-01-role-context";
      mkdirSync(join(projectDir, taskDir), { recursive: true });
      if (content !== undefined) {
        writeFile(join(projectDir, taskDir, "implement.jsonl"), content);
      }

      const result = runTask(projectDir, [
        "validate-role-context",
        taskDir,
        "implement",
      ]);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain(expected);
    },
  );

  it("validate-role-context blocks an unreadable referenced file", () => {
    const projectDir = createProject(false);
    const taskDir = ".trellis/tasks/01-01-role-context";
    const specPath = join(projectDir, ".trellis/spec/private.md");
    writeFile(specPath, "# Private spec\n");
    chmodSync(specPath, 0o000);
    writeFile(
      join(projectDir, taskDir, "implement.jsonl"),
      `${JSON.stringify({ file: ".trellis/spec/private.md", reason: "required" })}\n`,
    );

    const result = runTask(projectDir, [
      "validate-role-context",
      taskDir,
      "implement",
    ]);
    chmodSync(specPath, 0o600);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("no read permission");
  });

  it("validate-role-context accepts one valid role without requiring the other role", () => {
    const projectDir = createProject(false);
    const taskDir = ".trellis/tasks/01-01-role-context";
    writeFile(join(projectDir, ".trellis/spec/ready.md"), "# Ready spec\n");
    writeFile(
      join(projectDir, taskDir, "implement.jsonl"),
      `${JSON.stringify({ file: ".trellis/spec/ready.md", reason: "required" })}\n`,
    );

    const implement = runTask(projectDir, [
      "validate-role-context",
      taskDir,
      "implement",
    ]);
    const check = runTask(projectDir, [
      "validate-role-context",
      taskDir,
      "check",
    ]);

    expect(implement.status).toBe(0);
    expect(implement.stdout).toContain("Role context ready: implement.jsonl");
    expect(check.status).toBe(1);
    expect(check.stderr).toContain("check.jsonl: manifest is missing");
  });

  it("rejects quality evidence written into check.jsonl instead of context entries", () => {
    const projectDir = createProject(false);
    const taskDir = ".trellis/tasks/01-01-role-context";
    writeFile(
      join(projectDir, taskDir, "check.jsonl"),
      `${JSON.stringify({
        profile: "ITERATION",
        status: "PASSED",
        evidence: "pnpm test",
      })}\n`,
    );

    const result = runTask(projectDir, [
      "validate-role-context",
      taskDir,
      "check",
    ]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "entry requires a non-empty string field 'file'",
    );
    expect(result.stderr).toContain(
      "manifest has no valid readable 'file' entry",
    );
  });

  it("reports legacy task artifacts as UNKNOWN with migration guidance", () => {
    const projectDir = createProject();
    const taskDir = ".trellis/tasks/01-01-legacy";
    writeFile(
      join(projectDir, taskDir, "task.json"),
      JSON.stringify({ name: "legacy", status: "planning", meta: {} }),
    );
    writeFile(
      join(projectDir, taskDir, "prd.md"),
      "# Legacy\n\n## Goal\nKnown goal\n\n## Requirements\n- Known requirement\n\n## Acceptance Criteria\n- [ ] Known check\n",
    );

    const result = runTask(projectDir, ["start", taskDir]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Legacy task format is UNKNOWN");
    expect(result.stderr).toContain("structured Task Basis template");
  });

  it("reads old-format intent.md and reports an explicit compatibility migration", () => {
    const projectDir = createProject();
    const taskDir = ".trellis/tasks/01-01-legacy-intent";
    writeFile(
      join(projectDir, taskDir, "task.json"),
      JSON.stringify({ name: "legacy-intent", status: "planning", meta: {} }),
    );
    writeFile(
      join(projectDir, taskDir, "intent.md"),
      "# Intent\n\n## Why\nPreserve a pre-Task-Basis intent artifact.\n",
    );
    writeFile(
      join(projectDir, taskDir, "prd.md"),
      "# Legacy\n\n## Goal\nKnown goal\n\n## Requirements\n- Known requirement\n\n## Acceptance Criteria\n- [ ] Known check\n",
    );

    const result = runTask(projectDir, ["start", taskDir]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "Task Basis has no supported ## Classification",
    );
    expect(result.stderr).toContain("legacy tasks require explicit migration");
    expect(result.stderr).not.toContain("business-feature");
  });

  it("permits review revision to use review evidence without new Product Intent", () => {
    const projectDir = createProject();
    const createResult = runTask(projectDir, [
      "create",
      "Address MR review",
      "--slug",
      "review-revision",
      "--classification",
      "review-revision",
      "--no-start",
    ]);
    const taskDir = createResult.stdout.trim();
    completeTaskBasis(projectDir, taskDir, "review-revision", [
      "Status: NOT_REQUIRED",
      "Link:",
      "Reason: Review evidence https://gitlab.example/team/project/-/merge_requests/42#note_7 requests the scoped revision.",
    ]);

    expect(runTask(projectDir, ["start", taskDir]).status).toBe(0);
  });

  it("blocks linked review revision without concrete review evidence", () => {
    const projectDir = createProject();
    const createResult = runTask(projectDir, [
      "create",
      "Address MR review",
      "--slug",
      "review-revision-linked",
      "--classification",
      "review-revision",
      "--no-start",
    ]);
    const taskDir = createResult.stdout.trim();
    completeTaskBasis(projectDir, taskDir, "review-revision", [
      "Status: LINKED",
      "Link:",
      "Reason: Follow the original review.",
    ]);

    const result = runTask(projectDir, ["start", taskDir]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "LINKED requires the original approved or review evidence",
    );
  });

  it.each([
    ["missing", null],
    ["malformed", "not-json"],
  ])("blocks start when task.json is %s", (_name, replacement) => {
    const projectDir = createProject();
    const createResult = runTask(projectDir, [
      "create",
      "Refresh dependency",
      "--slug",
      `invalid-task-json-${_name}`,
      "--classification",
      "maintenance",
      "--product-intent-reason",
      "Engineering-only maintenance.",
      "--no-start",
    ]);
    const taskDir = createResult.stdout.trim();
    completeTaskBasis(projectDir, taskDir, "maintenance", [
      "Status: NOT_REQUIRED",
      "Link:",
      "Reason: Engineering-only maintenance.",
    ]);
    const taskJson = join(projectDir, taskDir, "task.json");
    if (replacement === null) rmSync(taskJson);
    else writeFile(taskJson, replacement);

    const result = runTask(projectDir, ["start", taskDir]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "Missing or invalid persisted task identity: task.json",
    );
  });

  it("rejects an empty acceptance checkbox as planning evidence", () => {
    const projectDir = createProject();
    const createResult = runTask(projectDir, [
      "create",
      "Refresh dependency",
      "--slug",
      "empty-acceptance",
      "--classification",
      "maintenance",
      "--product-intent-reason",
      "Engineering-only maintenance.",
      "--no-start",
    ]);
    const taskDir = createResult.stdout.trim();
    completeTaskBasis(projectDir, taskDir, "maintenance", [
      "Status: NOT_REQUIRED",
      "Link:",
      "Reason: Engineering-only maintenance.",
    ]);
    writeFile(
      join(projectDir, taskDir, "prd.md"),
      "# Planned change\n\n## Goal\nKnown goal\n\n## Requirements\n- Known requirement\n\n## Acceptance Criteria\n- [ ]\n",
    );

    const result = runTask(projectDir, ["start", taskDir]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "prd.md section is missing or incomplete: ## Acceptance Criteria",
    );
  });

  it("supports an explicit project opt-out", () => {
    const projectDir = createProject(false);
    const result = runTask(projectDir, [
      "create",
      "Legacy project task",
      "--slug",
      "legacy-project",
      "--no-start",
    ]);

    expect(result.status).toBe(0);
    const taskDir = result.stdout.trim();
    expect(
      readFileSync(join(projectDir, taskDir, "prd.md"), "utf-8"),
    ).toContain("## Goal");
  });

  it("keeps persisted Product Intent status consistent when governance is disabled", () => {
    const projectDir = createProject(false);
    const result = runTask(projectDir, [
      "create",
      "Opted-out business feature",
      "--slug",
      "opted-out-business-feature",
      "--classification",
      "business-feature",
      "--no-start",
    ]);

    expect(result.status).toBe(0);
    const taskDir = result.stdout.trim();
    const task = JSON.parse(
      readFileSync(join(projectDir, taskDir, "task.json"), "utf-8"),
    );
    const basis = readFileSync(join(projectDir, taskDir, "intent.md"), "utf-8");
    expect(task.meta).toMatchObject({
      classification: "business-feature",
      product_intent: "NOT_REQUIRED",
    });
    expect(basis).toContain("Status: NOT_REQUIRED");
    expect(basis).toContain("Link: \n");
  });

  it.each([
    ["false", false],
    ["ture", true],
  ])(
    "treats task_start enforce value %s with fail-safe semantics",
    (value, shouldBlock) => {
      const projectDir = createProject();
      writeFile(
        join(projectDir, ".trellis", "config.yaml"),
        [
          "governance:",
          "  enabled: true",
          "  enforce:",
          "    task_create: false",
          `    task_start: ${value}`,
          "",
        ].join("\n"),
      );
      const createResult = runTask(projectDir, [
        "create",
        "Legacy task",
        "--slug",
        `event-flag-${value}`,
        "--no-start",
      ]);
      const result = runTask(projectDir, ["start", createResult.stdout.trim()]);

      expect(result.status).toBe(shouldBlock ? 1 : 0);
      if (shouldBlock)
        expect(result.stderr).toContain("Governance gate blocked");
    },
  );

  it("accepts a valid external evaluator result", () => {
    const projectDir = createProjectWithEvaluator(
      'print(\'{"allowed": true, "status": "ready", "summary": "team gate passed"}\')\n',
    );
    const result = runTask(projectDir, [
      "create",
      "Externally governed task",
      "--slug",
      "external-ready",
      "--no-start",
    ]);

    expect(result.status).toBe(0);
    expect(taskDirs(projectDir)).toHaveLength(1);
  });

  it.each([
    ["empty output", "", "returned no JSON result"],
    ["invalid JSON", "print('not-json')\n", "returned invalid JSON"],
    [
      "missing allowed",
      'print(\'{"status": "ready"}\')\n',
      "returned a malformed result",
    ],
    [
      "contradictory status",
      'print(\'{"allowed": true, "status": "blocked"}\')\n',
      "returned a contradictory result",
    ],
    [
      "pending allowed status",
      'print(\'{"allowed": true, "status": "pending"}\')\n',
      "returned a contradictory result",
    ],
    [
      "allowed with blockers",
      'print(\'{"allowed": true, "status": "ready", "blockers": ["missing fact"]}\')\n',
      "returned a contradictory result",
    ],
    ["non-zero exit", "raise SystemExit(7)\n", "evaluator failed"],
  ])("fails closed for external evaluator %s", (_name, source, expected) => {
    const projectDir = createProjectWithEvaluator(source);
    const result = runTask(projectDir, [
      "create",
      "Externally governed task",
      "--slug",
      "external-blocked",
      "--no-start",
    ]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(expected);
    expect(taskDirs(projectDir)).toEqual([]);
  });

  it("fails closed when an external evaluator times out", () => {
    const projectDir = createProject();
    const python = [
      "import json",
      "import subprocess",
      "from pathlib import Path",
      "from common import governance_gate",
      "def raise_timeout(*args, **kwargs):",
      "    raise subprocess.TimeoutExpired(cmd='slow-evaluator', timeout=30)",
      "governance_gate.subprocess.run = raise_timeout",
      "result = governance_gate._result_from_command(",
      "    'slow-evaluator', event='task_create', repo_root=Path.cwd(),",
      "    message=None, task_dir=None, classification=None,",
      "    product_intent_link=None)",
      "print(json.dumps(result.as_dict()))",
    ].join("\n");
    const result = spawnSync("python3", ["-c", python], {
      cwd: projectDir,
      env: {
        ...process.env,
        PYTHONPATH: join(projectDir, ".trellis", "scripts"),
      },
      encoding: "utf-8",
    });

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      allowed: false,
      status: "blocked",
      summary: "External governance evaluator timed out.",
    });
  });

  it("fails closed when an external evaluator cannot be started", () => {
    const projectDir = createProject();
    const python = [
      "import json",
      "from pathlib import Path",
      "from common import governance_gate",
      "def raise_oserror(*args, **kwargs):",
      "    raise OSError('executor unavailable')",
      "governance_gate.subprocess.run = raise_oserror",
      "result = governance_gate._result_from_command(",
      "    'missing-evaluator', event='task_create', repo_root=Path.cwd(),",
      "    message=None, task_dir=None, classification=None,",
      "    product_intent_link=None)",
      "print(json.dumps(result.as_dict()))",
    ].join("\n");
    const result = spawnSync("python3", ["-c", python], {
      cwd: projectDir,
      env: {
        ...process.env,
        PYTHONPATH: join(projectDir, ".trellis", "scripts"),
      },
      encoding: "utf-8",
    });

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      allowed: false,
      status: "blocked",
      summary: "External governance evaluator could not be started.",
    });
  });
});
