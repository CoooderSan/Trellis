import { spawnSync } from "node:child_process";
import {
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

import {
  configYamlTemplate,
  getAllScripts,
} from "../../src/templates/trellis/index.js";

const tempDirs: string[] = [];

function writeFile(path: string, content: string) {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content, "utf-8");
}

function createProject(config = "") {
  const projectDir = mkdtempSync(join(tmpdir(), "trellis-governance-gate-"));
  tempDirs.push(projectDir);

  for (const [relativePath, content] of getAllScripts()) {
    writeFile(join(projectDir, ".trellis", "scripts", relativePath), content);
  }

  writeFile(join(projectDir, ".trellis", ".developer"), "name=agent\n");
  writeFile(
    join(projectDir, ".trellis", "config.yaml"),
    config || configYamlTemplate,
  );

  return projectDir;
}

function writePrd(projectDir: string, taskDir: string, content: string) {
  writeFile(join(projectDir, taskDir, "prd.md"), content);
}

function writeIntent(projectDir: string, taskDir: string, content: string) {
  writeFile(join(projectDir, taskDir, "intent.md"), content);
}

function runTask(projectDir: string, args: string[]) {
  return spawnSync("python3", [".trellis/scripts/task.py", ...args], {
    cwd: projectDir,
    encoding: "utf-8",
  });
}

function taskNames(projectDir: string) {
  try {
    return readdirSync(join(projectDir, ".trellis", "tasks")).filter(
      (name) => name !== "archive",
    );
  } catch {
    return [];
  }
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("governance hard gate template scripts", () => {
  const legacySessionGateConfig = [
    "governance:",
    "  enabled: true",
    "  enforce:",
    "    task_create: true",
    "    task_start: true",
    "",
  ].join("\n");

  const planGateConfig = [
    "governance:",
    "  enabled: true",
    "  enforce:",
    "    task_create: false",
    "    task_start: true",
    "  plan_gate:",
    "    enabled: true",
    "    intent_document:",
    "      enabled: true",
    "      path: intent.md",
    "    intent_required_sections:",
    "      - Intent",
    "      - Scope",
    "      - Acceptance Criteria",
    "    required_sections:",
    "      - Goal",
    "      - Requirements",
    "      - Acceptance Criteria",
    "",
  ].join("\n");

  const legacyPlanGateConfig = [
    "governance:",
    "  enabled: true",
    "  enforce:",
    "    task_create: false",
    "    task_start: true",
    "  plan_gate:",
    "    enabled: true",
    "    required_sections:",
    "      - Intent",
    "      - Goal",
    "      - Requirements",
    "      - Acceptance Criteria",
    "    require_risk: false",
    "",
  ].join("\n");

  it("keeps legacy session-gate behavior when plan_gate is not enabled", () => {
    const projectDir = createProject(legacySessionGateConfig);
    const result = runTask(projectDir, [
      "create",
      "Add demo feature",
      "--slug",
      "demo",
    ]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Governance gate blocked task_create");
    expect(result.stderr).toContain("No session gate result has been recorded");
    expect(taskNames(projectDir)).toEqual([]);
  });

  it("allows task creation without intent when only task_start is gated", () => {
    const projectDir = createProject(planGateConfig);

    const result = runTask(projectDir, [
      "create",
      "Add demo feature",
      "--slug",
      "demo",
    ]);

    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/\.trellis\/tasks\/\d{2}-\d{2}-demo/);
    expect(taskNames(projectDir)).toHaveLength(1);

    const intent = readFileSync(
      join(projectDir, result.stdout.trim(), "intent.md"),
      "utf-8",
    );
    const prd = readFileSync(
      join(projectDir, result.stdout.trim(), "prd.md"),
      "utf-8",
    );
    expect(intent).toContain("## Intent");
    expect(intent).toContain("## Scope");
    expect(prd).not.toContain("## Intent");
    expect(prd).toContain("## Risk");
  });

  it("blocks task activation while the plan/intent artifact is still a skeleton", () => {
    const projectDir = createProject(planGateConfig);
    const createResult = runTask(projectDir, [
      "create",
      "Add demo feature",
      "--slug",
      "demo",
    ]);
    expect(createResult.status).toBe(0);
    const taskDir = createResult.stdout.trim();

    const startResult = runTask(projectDir, ["start", taskDir]);

    expect(startResult.status).toBe(1);
    expect(startResult.stderr).toContain("Governance gate blocked task_start");
    expect(startResult.stderr).toContain("Plan/Intent gate blocked task_start");
    expect(startResult.stderr).toContain(
      "Required intent.md section is still empty/TBD: ## Intent",
    );
    expect(startResult.stderr).toContain(
      "Required prd.md section is still empty/TBD: ## Goal",
    );
    expect(existsSync(join(projectDir, ".trellis", ".current-task"))).toBe(
      false,
    );
  });

  it("allows task activation after intent.md and prd.md contain real content", () => {
    const projectDir = createProject(planGateConfig);
    const createResult = runTask(projectDir, [
      "create",
      "Add demo feature",
      "--slug",
      "demo",
    ]);
    expect(createResult.status).toBe(0);
    const taskDir = createResult.stdout.trim();

    writeIntent(
      projectDir,
      taskDir,
      [
        "# Intent: Add demo feature",
        "",
        "## Intent",
        "User confirmed the product needs a demo feature for onboarding validation.",
        "",
        "## Source",
        "- User request in the current planning session.",
        "",
        "## Scope",
        "- In scope: add the demo feature behind the existing workflow.",
        "- Out of scope: production data changes.",
        "",
        "## Acceptance Criteria",
        "- [ ] Demo task can be activated only after plan review.",
        "",
      ].join("\n"),
    );

    writePrd(
      projectDir,
      taskDir,
      [
        "# Add demo feature",
        "",
        "## Goal",
        "Expose a minimal demo feature behind the existing workflow.",
        "",
        "## Requirements",
        "- Reuse existing task creation flow.",
        "- Avoid production data changes.",
        "",
        "## Acceptance Criteria",
        "- [ ] Demo task can be activated only after plan review.",
        "",
        "## Risk",
        "- Level: Low",
        "",
      ].join("\n"),
    );

    const startResult = runTask(projectDir, ["start", taskDir]);

    expect(startResult.status).toBe(0);
    expect(startResult.stderr).not.toContain(
      "Governance gate blocked task_start",
    );
  });

  it("maps legacy PRD Intent section config to intent.md", () => {
    const projectDir = createProject(legacyPlanGateConfig);
    const createResult = runTask(projectDir, [
      "create",
      "Add demo feature",
      "--slug",
      "demo",
    ]);
    expect(createResult.status).toBe(0);
    const taskDir = createResult.stdout.trim();

    writeIntent(
      projectDir,
      taskDir,
      [
        "# Intent: Add demo feature",
        "",
        "## Intent",
        "User confirmed this feature should be implemented.",
        "",
        "## Scope",
        "- In scope: the demo workflow.",
        "- Out of scope: production data changes.",
        "",
        "## Acceptance Criteria",
        "- [ ] Feature can be validated in the demo flow.",
        "",
      ].join("\n"),
    );

    writePrd(
      projectDir,
      taskDir,
      [
        "# Add demo feature",
        "",
        "## Goal",
        "Expose a minimal demo feature.",
        "",
        "## Requirements",
        "- Reuse existing task creation flow.",
        "",
        "## Acceptance Criteria",
        "- [ ] Feature can be validated in the demo flow.",
        "",
      ].join("\n"),
    );

    const startResult = runTask(projectDir, ["start", taskDir]);

    expect(startResult.status).toBe(0);
    expect(startResult.stderr).not.toContain(
      "Missing required prd.md section: ## Intent",
    );
  });
});
