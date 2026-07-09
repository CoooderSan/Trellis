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
    "    required_sections:",
    "      - Intent",
    "      - Goal",
    "      - Requirements",
    "      - Acceptance Criteria",
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

    const prd = readFileSync(join(projectDir, result.stdout.trim(), "prd.md"), "utf-8");
    expect(prd).toContain("## Intent");
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
    expect(startResult.stderr).toContain("Required prd.md section is still empty/TBD: ## Intent");
    expect(existsSync(join(projectDir, ".trellis", ".current-task"))).toBe(
      false,
    );
  });

  it("allows task activation after prd.md contains a real intent plan", () => {
    const projectDir = createProject(planGateConfig);
    const createResult = runTask(projectDir, [
      "create",
      "Add demo feature",
      "--slug",
      "demo",
    ]);
    expect(createResult.status).toBe(0);
    const taskDir = createResult.stdout.trim();

    writePrd(
      projectDir,
      taskDir,
      [
        "# Add demo feature",
        "",
        "## Intent",
        "User confirmed the product needs a demo feature for onboarding validation.",
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
    expect(startResult.stderr).not.toContain("Governance gate blocked task_start");
  });
});
