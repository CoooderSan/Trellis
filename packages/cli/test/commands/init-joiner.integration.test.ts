/**
 * Integration tests for the joiner-onboarding branch of init().
 *
 * Covers the three-branch dispatch:
 *   no .trellis/                        → creator bootstrap task
 *   .trellis/ exists, .developer missing → joiner onboarding task
 *   both exist                           → no task created
 *
 * Uses the same fs-temp-dir + hoisted-mock approach as init.integration.test.ts.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const templateScriptsDir = fileURLToPath(
  new URL("../../src/templates/trellis/scripts/", import.meta.url),
);

// === External dependency mocks (hoisted by vitest) ===

vi.mock("figlet", () => ({
  default: { textSync: vi.fn(() => "TRELLIS") },
}));

vi.mock("inquirer", () => ({
  default: { prompt: vi.fn().mockResolvedValue({}) },
}));

vi.mock("node:child_process", () => ({
  execSync: vi.fn().mockImplementation((cmd: string) => {
    const py = process.platform === "win32" ? "python" : "python3";
    return cmd === `${py} --version` ? "Python 3.11.12" : "";
  }),
}));

// === Imports ===

import { init } from "../../src/commands/init.js";
import { getConfiguredPlatforms } from "../../src/configurators/index.js";
import { DIR_NAMES, FILE_NAMES, PATHS } from "../../src/constants/paths.js";
import { loadHashes } from "../../src/utils/template-hash.js";
import { execSync } from "node:child_process";

// eslint-disable-next-line @typescript-eslint/no-empty-function
const noop = () => {};

describe("init() joiner onboarding", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "trellis-joiner-int-"));
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);
    vi.spyOn(console, "log").mockImplementation(noop);
    vi.spyOn(console, "warn").mockImplementation(noop);
    vi.spyOn(console, "error").mockImplementation(noop);
    vi.mocked(execSync).mockClear();
    vi.mocked(execSync).mockImplementation(((cmd: string) => {
      const py = process.platform === "win32" ? "python" : "python3";
      return cmd === `${py} --version` ? "Python 3.11.12" : "";
    }) as typeof execSync);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  /**
   * Helper: simulate a fresh clone of an existing Trellis project — `.trellis/`
   * committed (with at least one archived task indicating prior work),
   * `.developer` absent. Real fresh-clone state always has either an active or
   * archived bootstrap task; an empty `tasks/` indicates an aborted partial
   * init (issue #204) and triggers the bootstrap fallback instead of joiner.
   *
   * NOTE: the seeded `tasks/archive/` is load-bearing for the joiner branch.
   * If you change the `tasksEmpty` predicate in init.ts (currently
   * `!exists || readdirSync().length === 0`), audit this helper — e.g., if
   * archive/ stops counting as "non-empty", every joiner test below regresses
   * into the bootstrap-fallback branch and assertions flip silently.
   */
  function simulateExistingCheckout(): void {
    const workflow = path.join(tmpDir, DIR_NAMES.WORKFLOW);
    fs.mkdirSync(path.join(workflow, DIR_NAMES.TASKS, "archive"), {
      recursive: true,
    });
    const specDir = path.join(workflow, DIR_NAMES.SPEC);
    fs.mkdirSync(path.join(specDir, "backend"), { recursive: true });
    fs.writeFileSync(
      path.join(specDir, "backend", "quality-guidelines.md"),
      "# Project quality guidelines\n",
      "utf-8",
    );
    fs.mkdirSync(path.join(workflow, DIR_NAMES.WORKSPACE), { recursive: true });
    fs.cpSync(templateScriptsDir, path.join(workflow, DIR_NAMES.SCRIPTS), {
      recursive: true,
    });
  }

  /** Helper: simulate same-dev re-init — both `.trellis/` and `.developer` exist */
  function simulateSameDevReinit(name: string): void {
    simulateExistingCheckout();
    fs.writeFileSync(
      path.join(tmpDir, PATHS.DEVELOPER_FILE),
      `${name}\n`,
      "utf-8",
    );
  }

  async function expectClassifiedPlanningTaskStartsSuccessfully(
    taskDir: string,
  ): Promise<void> {
    const taskJson = JSON.parse(
      fs.readFileSync(path.join(taskDir, FILE_NAMES.TASK_JSON), "utf-8"),
    );
    expect(taskJson.status).toBe("planning");
    expect(taskJson.meta).toMatchObject({
      classification: "maintenance",
      product_intent: "NOT_REQUIRED",
    });
    expect(taskJson.meta.product_intent_reason).toContain(
      "engineering workflow context",
    );

    const intent = fs.readFileSync(path.join(taskDir, "intent.md"), "utf-8");
    expect(intent).toContain("## Classification\n\nmaintenance");
    expect(intent).toContain("Status: NOT_REQUIRED");
    expect(intent).toContain("## Requested Outcome");
    expect(intent).toContain("## In Scope / Out of Scope");
    expect(intent).toContain("## Acceptance or Verification Basis");

    const prd = fs.readFileSync(path.join(taskDir, FILE_NAMES.PRD), "utf-8");
    expect(prd).toContain("## Goal");
    expect(prd).toContain("## Requirements");
    expect(prd).toContain("## Acceptance Criteria");
    expect(prd).toContain("task.py start");

    const configPath = path.join(tmpDir, DIR_NAMES.WORKFLOW, "config.yaml");
    if (!fs.existsSync(configPath)) {
      fs.writeFileSync(
        configPath,
        "governance:\n  enabled: true\n  enforce:\n    task_create: true\n    task_start: true\n",
        "utf-8",
      );
    }

    const actualChildProcess =
      await vi.importActual<typeof import("node:child_process")>(
        "node:child_process",
      );
    const pythonCommand = process.platform === "win32" ? "python" : "python3";
    const taskName = path.basename(taskDir);
    const contextId = `init-integration-${taskName}`;
    const taskScript = path.join(tmpDir, PATHS.SCRIPTS, "task.py");
    expect(fs.existsSync(taskScript)).toBe(true);

    const output = actualChildProcess.execFileSync(
      pythonCommand,
      [taskScript, "start", taskName],
      {
        cwd: tmpDir,
        encoding: "utf-8",
        env: { ...process.env, TRELLIS_CONTEXT_ID: contextId },
      },
    );
    expect(output).toContain(`Current task set to: .trellis/tasks/${taskName}`);
    expect(output).toContain("Status: planning → in_progress");

    const startedTaskJson = JSON.parse(
      fs.readFileSync(path.join(taskDir, FILE_NAMES.TASK_JSON), "utf-8"),
    );
    expect(startedTaskJson.status).toBe("in_progress");

    const sessionState = JSON.parse(
      fs.readFileSync(
        path.join(
          tmpDir,
          DIR_NAMES.WORKFLOW,
          ".runtime",
          "sessions",
          `${contextId}.json`,
        ),
        "utf-8",
      ),
    );
    expect(sessionState.current_task).toBe(`.trellis/tasks/${taskName}`);
    expect(fs.existsSync(path.join(tmpDir, PATHS.CURRENT_TASK_FILE))).toBe(
      false,
    );
  }

  it("#1 empty cwd + init → creator bootstrap task created", async () => {
    await init({ yes: true, user: "alice" });

    const bootstrap = path.join(tmpDir, PATHS.TASKS, "00-bootstrap-guidelines");
    expect(fs.existsSync(bootstrap)).toBe(true);
    await expectClassifiedPlanningTaskStartsSuccessfully(bootstrap);

    // No joiner task present
    const joiner = path.join(tmpDir, PATHS.TASKS, "00-join-alice");
    expect(fs.existsSync(joiner)).toBe(false);
  });

  it("#2 existing .trellis/ + no .developer → joiner onboarding task created", async () => {
    simulateExistingCheckout();

    await init({ yes: true, user: "bob", force: true });

    const joiner = path.join(tmpDir, PATHS.TASKS, "00-join-bob");
    expect(fs.existsSync(joiner)).toBe(true);

    const taskJson = JSON.parse(
      fs.readFileSync(path.join(joiner, FILE_NAMES.TASK_JSON), "utf-8"),
    );
    expect(taskJson.id).toBe("00-join-bob");
    expect(taskJson.name).toBe("00-join-bob");
    expect(taskJson.status).toBe("planning");
    expect(taskJson.dev_type).toBe("docs");
    expect(taskJson.priority).toBe("P1");
    expect(taskJson.creator).toBe("bob");
    expect(taskJson.assignee).toBe("bob");
    expect(taskJson.title).toContain("bob");
    await expectClassifiedPlanningTaskStartsSuccessfully(joiner);

    const prd = fs.readFileSync(path.join(joiner, FILE_NAMES.PRD), "utf-8");
    // PRD is AI-facing instructions ("you (the AI) are running this task").
    // Mentions the developer in context + user-facing elements the AI should
    // reference.
    expect(prd).toContain("bob");
    expect(prd).toContain("You (the AI) are running this task");
    expect(prd).toContain("workflow.md");
    expect(prd).toContain(".trellis/spec/");
    expect(prd).toContain("00-join-bob");
    expect(prd).toContain("This is a joiner flow, not creator bootstrap");
    expect(prd).toContain("do not recreate, rewrite");
    expect(prd).toContain("In inline mode");
    expect(prd).not.toContain("Core slash commands");
    expect(prd).not.toContain("implement via sub-agents");
    // Fallback text for empty archive
    expect(prd).toContain("archive is empty");
    const expectedPythonCmd =
      process.platform === "win32" ? "python" : "python3";
    expect(prd).toContain(
      `${expectedPythonCmd} ./.trellis/scripts/task.py list --assignee bob`,
    );
    expect(prd).toContain(
      `${expectedPythonCmd} ./.trellis/scripts/task.py finish`,
    );
    expect(prd).toContain(
      `${expectedPythonCmd} ./.trellis/scripts/task.py archive 00-join-bob`,
    );

    // init creates the joiner task but does not set repo-global current-task state.
    expect(fs.existsSync(path.join(tmpDir, PATHS.CURRENT_TASK_FILE))).toBe(
      false,
    );

    // Bootstrap task NOT created
    expect(
      fs.existsSync(path.join(tmpDir, PATHS.TASKS, "00-bootstrap-guidelines")),
    ).toBe(false);
  });

  it("#2.1 force joiner re-init preserves existing platform ownership", async () => {
    await init({ yes: true, user: "creator", claude: true, codex: true });

    const hashesBefore = loadHashes(tmpDir);
    const platformHashesBefore = Object.fromEntries(
      Object.entries(hashesBefore).filter(([relativePath]) =>
        [".claude/", ".codex/"].some((prefix) =>
          relativePath.startsWith(prefix),
        ),
      ),
    );
    expect(Object.keys(platformHashesBefore).length).toBeGreaterThan(0);
    expect(getConfiguredPlatforms(tmpDir)).toEqual(
      new Set(["claude-code", "codex"]),
    );

    const userSpec = path.join(tmpDir, PATHS.SPEC, "team-owned.md");
    fs.writeFileSync(userSpec, "# Team-owned spec\n", "utf-8");

    // A fresh clone keeps the creator's committed templates + hash manifest,
    // but not the gitignored per-checkout developer identity. The mocked
    // init_developer command leaves that exact state for this second init.
    await init({ yes: true, force: true, user: "joiner", codex: true });

    const hashesAfter = loadHashes(tmpDir);
    expect(hashesAfter).toMatchObject(platformHashesBefore);
    expect(getConfiguredPlatforms(tmpDir)).toEqual(
      new Set(["claude-code", "codex"]),
    );
    expect(fs.readFileSync(userSpec, "utf-8")).toBe("# Team-owned spec\n");
    expect(
      fs.existsSync(path.join(tmpDir, PATHS.TASKS, "00-join-joiner")),
    ).toBe(true);
  });

  it("#2a existing checkout without a meaningful spec baseline → bootstrap repair, not joiner", async () => {
    simulateExistingCheckout();
    const specDir = path.join(tmpDir, PATHS.SPEC);
    fs.rmSync(specDir, { recursive: true, force: true });
    fs.mkdirSync(specDir, { recursive: true });
    fs.writeFileSync(
      path.join(specDir, "index.md"),
      "# Placeholder index only\n",
      "utf-8",
    );

    // No --force: this must bypass handleReinit and repair the baseline through
    // the full init path before creating the creator/bootstrap task.
    await init({ yes: true, user: "repair-owner" });

    const bootstrap = path.join(tmpDir, PATHS.TASKS, "00-bootstrap-guidelines");
    expect(fs.existsSync(bootstrap)).toBe(true);
    expect(
      fs.existsSync(path.join(tmpDir, PATHS.TASKS, "00-join-repair-owner")),
    ).toBe(false);
    expect(fs.existsSync(path.join(specDir, "backend", "index.md"))).toBe(true);

    const prd = fs.readFileSync(path.join(bootstrap, FILE_NAMES.PRD), "utf-8");
    expect(prd).toContain("## Detected spec inventory");
    expect(prd).not.toContain("This is a joiner flow, not creator bootstrap");
  });

  it("#2a.1 configured registry without loaded specs stays fail-closed in bootstrap", async () => {
    simulateExistingCheckout();
    const specDir = path.join(tmpDir, PATHS.SPEC);
    fs.rmSync(specDir, { recursive: true, force: true });
    fs.mkdirSync(specDir, { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, DIR_NAMES.WORKFLOW, "config.yaml"),
      "registry:\n  spec:\n    source: gitlab:team/spec-registry\n",
      "utf-8",
    );

    await init({ yes: true, user: "registry-repair-owner" });

    const bootstrap = path.join(tmpDir, PATHS.TASKS, "00-bootstrap-guidelines");
    expect(fs.existsSync(bootstrap)).toBe(true);
    expect(
      fs.existsSync(
        path.join(tmpDir, PATHS.TASKS, "00-join-registry-repair-owner"),
      ),
    ).toBe(false);

    const prd = fs.readFileSync(path.join(bootstrap, FILE_NAMES.PRD), "utf-8");
    expect(prd).toContain(
      "A spec source is configured as **gitlab:team/spec-registry**",
    );
    expect(prd).toContain("did not confirm a successful load");
    expect(prd).toContain("generated fallback files");
    expect(prd).not.toContain("was loaded during init");

    const taskJson = JSON.parse(
      fs.readFileSync(path.join(bootstrap, FILE_NAMES.TASK_JSON), "utf-8"),
    );
    expect(taskJson.notes).toContain("configured but unconfirmed");
  });

  it("#2a.2 a non-empty nested spec index is a meaningful local baseline", async () => {
    simulateExistingCheckout();
    const specDir = path.join(tmpDir, PATHS.SPEC);
    fs.rmSync(specDir, { recursive: true, force: true });
    fs.mkdirSync(path.join(specDir, "backend"), { recursive: true });
    fs.writeFileSync(
      path.join(specDir, "backend", "index.md"),
      "# Backend team spec\n",
      "utf-8",
    );

    await init({ yes: true, user: "nested-index-joiner" });

    expect(
      fs.existsSync(
        path.join(tmpDir, PATHS.TASKS, "00-join-nested-index-joiner"),
      ),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(tmpDir, PATHS.TASKS, "00-bootstrap-guidelines")),
    ).toBe(false);
  });

  it("#2b issue #204: existing .trellis/ but tasks/ empty → bootstrap fallback (--yes alone, no --force)", async () => {
    // Mirrors the exact reproduction in issue #204: first run aborted partway
    // after writing the .trellis/ skeleton but before creating bootstrap;
    // second run uses `--yes` alone (no --force, no --skip-existing) to recover.
    // Without the empty-tasks early-bypass at init.ts:931, this command would
    // route through handleReinit and mis-create a joiner task.
    const workflow = path.join(tmpDir, DIR_NAMES.WORKFLOW);
    fs.mkdirSync(path.join(workflow, DIR_NAMES.TASKS), { recursive: true });
    fs.mkdirSync(path.join(workflow, DIR_NAMES.SPEC), { recursive: true });
    fs.mkdirSync(path.join(workflow, DIR_NAMES.WORKSPACE), { recursive: true });

    await init({ yes: true, user: "alice" });

    expect(
      fs.existsSync(path.join(tmpDir, PATHS.TASKS, "00-bootstrap-guidelines")),
    ).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, PATHS.TASKS, "00-join-alice"))).toBe(
      false,
    );
  });

  it("#2c issue #204 with --force: empty tasks/ also triggers bootstrap fallback (not joiner)", async () => {
    // Same recovery scenario but with --force, which bypasses handleReinit
    // via the original guard rather than the empty-tasks bypass. Both paths
    // must converge on bootstrap creation.
    const workflow = path.join(tmpDir, DIR_NAMES.WORKFLOW);
    fs.mkdirSync(path.join(workflow, DIR_NAMES.TASKS), { recursive: true });
    fs.mkdirSync(path.join(workflow, DIR_NAMES.SPEC), { recursive: true });
    fs.mkdirSync(path.join(workflow, DIR_NAMES.WORKSPACE), { recursive: true });

    await init({ yes: true, user: "alice", force: true });

    expect(
      fs.existsSync(path.join(tmpDir, PATHS.TASKS, "00-bootstrap-guidelines")),
    ).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, PATHS.TASKS, "00-join-alice"))).toBe(
      false,
    );
  });

  it("#3 existing .trellis/ + .developer → no task created", async () => {
    simulateSameDevReinit("carol");

    await init({ yes: true, user: "carol", force: true });

    expect(fs.existsSync(path.join(tmpDir, PATHS.TASKS, "00-join-carol"))).toBe(
      false,
    );
    expect(
      fs.existsSync(path.join(tmpDir, PATHS.TASKS, "00-bootstrap-guidelines")),
    ).toBe(false);
  });

  it("#4 after joiner archive but .developer remains → no new task on re-init", async () => {
    simulateExistingCheckout();

    await init({ yes: true, user: "dave", force: true });
    const joinerPath = path.join(tmpDir, PATHS.TASKS, "00-join-dave");
    expect(fs.existsSync(joinerPath)).toBe(true);

    // Manually create the .developer file that init_developer.py would have
    // written (it's mocked in this test), then archive the joiner task.
    fs.writeFileSync(
      path.join(tmpDir, PATHS.DEVELOPER_FILE),
      "dave\n",
      "utf-8",
    );
    fs.rmSync(joinerPath, { recursive: true, force: true });

    // Re-init: should NOT recreate the joiner task
    await init({ yes: true, user: "dave", force: true });

    expect(fs.existsSync(joinerPath)).toBe(false);
  });

  it("#5a developer name with spaces → filesystem-safe slug", async () => {
    simulateExistingCheckout();

    await init({ yes: true, user: "Tao Su", force: true });

    const joiner = path.join(tmpDir, PATHS.TASKS, "00-join-tao-su");
    expect(fs.existsSync(joiner)).toBe(true);

    const taskJson = JSON.parse(
      fs.readFileSync(path.join(joiner, FILE_NAMES.TASK_JSON), "utf-8"),
    );
    expect(taskJson.creator).toBe("Tao Su");
    expect(taskJson.title).toContain("Tao Su");
  });

  it("#5b developer name with '/' → slug strips separator", async () => {
    simulateExistingCheckout();

    await init({ yes: true, user: "@org/bob", force: true });

    // slugifyDeveloperName: lowercase @org/bob → punctuation-collapsed to "org-bob"
    const joiner = path.join(tmpDir, PATHS.TASKS, "00-join-org-bob");
    expect(fs.existsSync(joiner)).toBe(true);
  });

  it("#5c developer name with Unicode letters → task dir is filesystem-safe", async () => {
    simulateExistingCheckout();

    await init({ yes: true, user: "田中 太郎", force: true });

    // Unicode letters pass through \p{Letter}, so dir name is non-empty
    const entries = fs
      .readdirSync(path.join(tmpDir, PATHS.TASKS))
      .filter((name) => name.startsWith("00-join-"));
    expect(entries).toHaveLength(1);

    const joiner = path.join(tmpDir, PATHS.TASKS, entries[0]);
    const taskJson = JSON.parse(
      fs.readFileSync(path.join(joiner, FILE_NAMES.TASK_JSON), "utf-8"),
    );
    expect(taskJson.creator).toBe("田中 太郎");
  });

  it("#6 joiner creation failure surfaces as warning, init does not crash", async () => {
    // Simulate "fresh clone" state, then set up conditions that make
    // writeTaskSkeleton's mkdirSync fail: writeFileSync for task.json can be
    // thwarted by making .trellis/tasks read-only right before dispatch,
    // but that's fragile cross-platform. A simpler approach: spy on
    // fs.writeFileSync to throw for the joiner's task.json path, forcing
    // writeTaskSkeleton's catch block to return false, which in turn triggers
    // the console.warn in the init dispatch.
    simulateExistingCheckout();

    const originalWriteFileSync = fs.writeFileSync;
    const writeSpy = vi.spyOn(fs, "writeFileSync").mockImplementation(((
      filePath: fs.PathOrFileDescriptor,
      data: string | NodeJS.ArrayBufferView,
      options?: fs.WriteFileOptions,
    ) => {
      const pathStr = String(filePath);
      if (pathStr.includes("00-join-eve") && pathStr.endsWith("task.json")) {
        throw new Error("simulated write failure");
      }
      return originalWriteFileSync(filePath, data, options);
    }) as typeof fs.writeFileSync);

    const warnSpy = vi.spyOn(console, "warn");

    await expect(
      init({ yes: true, user: "eve", force: true }),
    ).resolves.toBeUndefined();

    expect(
      warnSpy.mock.calls.some((call) =>
        call.some(
          (arg) =>
            typeof arg === "string" &&
            arg.includes("Failed to create joiner onboarding task"),
        ),
      ),
    ).toBe(true);

    writeSpy.mockRestore();
  });

  // Tests #7/#8 cover the handleReinit path — the default flow when .trellis/
  // already exists and neither --force nor --skip-existing is passed. init()
  // routes through handleReinit() instead of the main dispatch, so joiner
  // creation is wired separately inside handleReinit's add-developer branch.
  // The earlier tests all pass force:true, which bypasses this path.

  it("#7 handleReinit path: existing .trellis/ + no .developer → joiner task created", async () => {
    simulateExistingCheckout();

    await init({ yes: true, user: "frank" });

    const joiner = path.join(tmpDir, PATHS.TASKS, "00-join-frank");
    expect(fs.existsSync(joiner)).toBe(true);

    const taskJson = JSON.parse(
      fs.readFileSync(path.join(joiner, FILE_NAMES.TASK_JSON), "utf-8"),
    );
    expect(taskJson.creator).toBe("frank");
    expect(taskJson.status).toBe("planning");
    await expectClassifiedPlanningTaskStartsSuccessfully(joiner);

    expect(fs.existsSync(path.join(tmpDir, PATHS.CURRENT_TASK_FILE))).toBe(
      false,
    );
  });

  it("#8 handleReinit path: existing .trellis/ + .developer → no task created", async () => {
    simulateSameDevReinit("grace");

    await init({ yes: true, user: "grace" });

    expect(fs.existsSync(path.join(tmpDir, PATHS.TASKS, "00-join-grace"))).toBe(
      false,
    );
    expect(
      fs.existsSync(path.join(tmpDir, PATHS.TASKS, "00-bootstrap-guidelines")),
    ).toBe(false);
  });
});
