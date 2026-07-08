import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
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

function writeGateState(projectDir: string, state: Record<string, unknown>) {
  writeFile(
    join(projectDir, ".trellis", "workspace", "agent", "session-gate.json"),
    `${JSON.stringify(state, null, 2)}\n`,
  );
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
  const enabledConfig = [
    "governance:",
    "  enabled: true",
    "  enforce:",
    "    task_create: true",
    "    task_start: true",
    "",
  ].join("\n");

  it("blocks task creation when governance is enabled and no session gate passed", () => {
    const projectDir = createProject(enabledConfig);
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

  it("allows task creation after a ready session gate result", () => {
    const projectDir = createProject(enabledConfig);
    writeGateState(projectDir, {
      status: "ready",
      taskType: "development",
      request: "Add demo feature",
      summary: "Preflight passed",
      blockers: [],
      nextStep: "Create the Trellis task",
    });

    const result = runTask(projectDir, [
      "create",
      "Add demo feature",
      "--slug",
      "demo",
    ]);

    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/\.trellis\/tasks\/\d{2}-\d{2}-demo/);
    expect(taskNames(projectDir)).toHaveLength(1);
  });

  it("blocks task activation when the gate later becomes blocked", () => {
    const projectDir = createProject(enabledConfig);
    writeGateState(projectDir, {
      status: "ready",
      taskType: "development",
      request: "Add demo feature",
      summary: "Preflight passed",
      blockers: [],
    });

    const createResult = runTask(projectDir, [
      "create",
      "Add demo feature",
      "--slug",
      "demo",
    ]);
    expect(createResult.status).toBe(0);
    const taskDir = createResult.stdout.trim();

    writeGateState(projectDir, {
      status: "blocked",
      taskType: "development",
      request: "Add demo feature",
      summary: "Intent is missing",
      blockers: ["Intent missing"],
      nextStep: "Write Intent first",
    });

    const startResult = runTask(projectDir, ["start", taskDir]);

    expect(startResult.status).toBe(1);
    expect(startResult.stderr).toContain("Governance gate blocked task_start");
    expect(startResult.stderr).toContain("Intent missing");
    expect(existsSync(join(projectDir, ".trellis", ".current-task"))).toBe(
      false,
    );
  });
});
