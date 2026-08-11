import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getSharedHookScripts } from "../../src/templates/shared-hooks/index.js";
import { getAllScripts } from "../../src/templates/trellis/index.js";

const pythonCmd = process.platform === "win32" ? "python" : "python3";
const taskRef = ".trellis/tasks/demo-task";

interface HookResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

interface HookPayload {
  hookSpecificOutput?: {
    hookEventName?: string;
    permissionDecision?: string;
    permissionDecisionReason?: string;
    updatedInput?: { prompt?: string };
    additionalContext?: string;
  };
  permission?: string;
  updated_input?: { prompt?: string };
  user_message?: string;
  agent_message?: string;
}

describe("shared subagent hook pre-dispatch role-context gate", () => {
  let projectDir: string;
  let hookPath: string;
  let taskDir: string;

  beforeEach(() => {
    projectDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "trellis-shared-predispatch-"),
    );
    hookPath = path.join(
      projectDir,
      ".claude",
      "hooks",
      "inject-subagent-context.py",
    );
    taskDir = path.join(projectDir, taskRef);

    fs.mkdirSync(path.join(projectDir, ".git"), { recursive: true });
    fs.mkdirSync(path.dirname(hookPath), { recursive: true });
    fs.mkdirSync(taskDir, { recursive: true });
    fs.mkdirSync(path.join(projectDir, ".trellis", "spec"), {
      recursive: true,
    });

    for (const [relativePath, content] of getAllScripts()) {
      writeFile(path.join(".trellis", "scripts", relativePath), content);
    }
    const hook = getSharedHookScripts().find(
      ({ name }) => name === "inject-subagent-context.py",
    );
    if (!hook) throw new Error("inject-subagent-context.py template missing");
    fs.writeFileSync(hookPath, hook.content, "utf8");

    writeFile(
      path.join(".trellis", "config.yaml"),
      "governance:\n  enabled: false\n",
    );
    writeFile(path.join(taskRef, "prd.md"), "# Demo PRD\n");
    writeFile(path.join(".trellis", "spec", "demo.md"), "# Demo Spec\n");
    const curated =
      JSON.stringify({ file: ".trellis/spec/demo.md", reason: "test" }) + "\n";
    writeFile(path.join(taskRef, "implement.jsonl"), curated);
    writeFile(path.join(taskRef, "check.jsonl"), curated);
    writeSession("claude", "parent", taskRef);
  });

  afterEach(() => {
    fs.rmSync(projectDir, { recursive: true, force: true });
  });

  function writeFile(relativePath: string, content: string): void {
    const fullPath = path.join(projectDir, relativePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content, "utf8");
  }

  function writeSession(platform: string, session: string, task: string): void {
    writeFile(
      path.join(
        ".trellis",
        ".runtime",
        "sessions",
        `${platform}_${session}.json`,
      ),
      JSON.stringify({ current_task: task, platform }),
    );
  }

  function runHook(
    payload: Record<string, unknown>,
    envOverrides: NodeJS.ProcessEnv = { CLAUDE_PROJECT_DIR: projectDir },
  ): HookResult {
    const env = { ...process.env, ...envOverrides };
    delete env.TRELLIS_CONTEXT_ID;
    delete env.TRELLIS_DISABLE_HOOKS;
    delete env.TRELLIS_HOOKS;
    const result = spawnSync(pythonCmd, [hookPath], {
      cwd: projectDir,
      input: JSON.stringify(payload),
      encoding: "utf8",
      env,
    });
    return {
      status: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  }

  function claudeDispatch(
    subagentType: string,
    prompt = "perform the delegated role",
  ): Record<string, unknown> {
    return {
      hook_event_name: "PreToolUse",
      tool_name: "Agent",
      tool_input: { subagent_type: subagentType, prompt },
      session_id: "parent",
      cwd: projectDir,
    };
  }

  function parsePayload(result: HookResult): HookPayload {
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    return JSON.parse(result.stdout) as HookPayload;
  }

  it("allows a curated implement manifest and injects its context", () => {
    const output = parsePayload(runHook(claudeDispatch("trellis-implement")));

    expect(output.hookSpecificOutput?.permissionDecision).toBe("allow");
    expect(output.permission).toBe("allow");
    expect(output.updated_input?.prompt).toContain(
      "=== .trellis/spec/demo.md ===",
    );
  });

  it("remaps archived task self-references for validation and context injection", () => {
    const archivedTaskRef = ".trellis/tasks/archive/2026-08/demo-task";
    const archivedTaskDir = path.join(projectDir, archivedTaskRef);
    const historicalEvidencePath =
      ".trellis/tasks/demo-task/research/evidence.md";
    fs.mkdirSync(path.join(archivedTaskDir, "research"), { recursive: true });
    fs.writeFileSync(
      path.join(archivedTaskDir, "prd.md"),
      "# Archived Demo PRD\n",
      "utf8",
    );
    fs.writeFileSync(
      path.join(archivedTaskDir, "research", "evidence.md"),
      "ARCHIVED_SHARED_EVIDENCE_MARKER_42",
      "utf8",
    );
    fs.writeFileSync(
      path.join(archivedTaskDir, "implement.jsonl"),
      JSON.stringify({
        file: historicalEvidencePath,
        reason: "archived evidence",
      }) + "\n",
      "utf8",
    );
    writeSession("claude", "parent", archivedTaskRef);

    const output = parsePayload(runHook(claudeDispatch("trellis-implement")));

    expect(output.hookSpecificOutput?.permissionDecision).toBe("allow");
    expect(output.updated_input?.prompt).toContain(
      `=== ${historicalEvidencePath} ===`,
    );
    expect(output.updated_input?.prompt).toContain(
      "ARCHIVED_SHARED_EVIDENCE_MARKER_42",
    );
  });

  it("remaps historical backslash self-references inside an archived task", () => {
    const archivedTaskRef = ".trellis/tasks/archive/2026-08/demo-task";
    const archivedTaskDir = path.join(projectDir, archivedTaskRef);
    const historicalEvidencePath =
      ".trellis\\tasks\\demo-task\\research\\evidence.md";
    fs.mkdirSync(path.join(archivedTaskDir, "research"), { recursive: true });
    fs.writeFileSync(
      path.join(archivedTaskDir, "prd.md"),
      "# Archived Demo PRD\n",
      "utf8",
    );
    fs.writeFileSync(
      path.join(archivedTaskDir, "research", "evidence.md"),
      "ARCHIVED_BACKSLASH_EVIDENCE_MARKER_42",
      "utf8",
    );
    fs.writeFileSync(
      path.join(archivedTaskDir, "implement.jsonl"),
      JSON.stringify({
        file: historicalEvidencePath,
        reason: "historical Windows path",
      }) + "\n",
      "utf8",
    );
    writeSession("claude", "parent", archivedTaskRef);

    const output = parsePayload(runHook(claudeDispatch("trellis-implement")));

    expect(output.hookSpecificOutput?.permissionDecision).toBe("allow");
    expect(output.updated_input?.prompt).toContain(
      `=== ${historicalEvidencePath} ===`,
    );
    expect(output.updated_input?.prompt).toContain(
      "ARCHIVED_BACKSLASH_EVIDENCE_MARKER_42",
    );
  });

  it("does not fall back to a recreated live-task shadow when the archive copy is missing", () => {
    const archivedTaskRef = ".trellis/tasks/archive/2026-08/demo-task";
    const archivedTaskDir = path.join(projectDir, archivedTaskRef);
    const historicalEvidencePath =
      ".trellis/tasks/demo-task/research/evidence.md";
    fs.mkdirSync(archivedTaskDir, { recursive: true });
    fs.writeFileSync(
      path.join(archivedTaskDir, "prd.md"),
      "# Archived Demo PRD\n",
      "utf8",
    );
    fs.writeFileSync(
      path.join(archivedTaskDir, "implement.jsonl"),
      JSON.stringify({
        file: historicalEvidencePath,
        reason: "missing archived evidence",
      }) + "\n",
      "utf8",
    );
    writeFile(
      path.join(taskRef, "research", "evidence.md"),
      "LIVE_TASK_SHADOW_MUST_NOT_BE_INJECTED",
    );
    writeSession("claude", "parent", archivedTaskRef);

    const output = parsePayload(runHook(claudeDispatch("trellis-implement")));
    const reason = output.hookSpecificOutput?.permissionDecisionReason ?? "";

    expect(output.hookSpecificOutput?.permissionDecision).toBe("deny");
    expect(reason).toContain("referenced file cannot be read");
    expect(JSON.stringify(output)).not.toContain(
      "LIVE_TASK_SHADOW_MUST_NOT_BE_INJECTED",
    );
    expect(output.updated_input).toBeUndefined();
  });

  it.skipIf(process.platform === "win32")(
    "rejects an archived directory entry when a Markdown file symlink escapes, without injecting safe siblings",
    () => {
      const archivedTaskRef = ".trellis/tasks/archive/2026-08/demo-task";
      const archivedTaskDir = path.join(projectDir, archivedTaskRef);
      const archivedResearchDir = path.join(archivedTaskDir, "research");
      const historicalResearchPath = ".trellis/tasks/demo-task/research";
      const externalSecret = path.join(
        projectDir,
        ".trellis",
        "spec",
        "external-secret.md",
      );
      fs.mkdirSync(archivedResearchDir, { recursive: true });
      fs.writeFileSync(
        path.join(archivedTaskDir, "prd.md"),
        "# Archived Demo PRD\n",
        "utf8",
      );
      fs.writeFileSync(
        path.join(archivedResearchDir, "safe.md"),
        "SAFE_ARCHIVE_SIBLING_MUST_NOT_BE_INJECTED",
        "utf8",
      );
      fs.writeFileSync(
        externalSecret,
        "EXTERNAL_ARCHIVE_SECRET_MUST_NOT_BE_INJECTED",
        "utf8",
      );
      fs.symlinkSync(
        externalSecret,
        path.join(archivedResearchDir, "escaped.md"),
      );
      fs.writeFileSync(
        path.join(archivedTaskDir, "implement.jsonl"),
        JSON.stringify({
          file: historicalResearchPath,
          type: "directory",
          reason: "archived research",
        }) + "\n",
        "utf8",
      );
      writeSession("claude", "parent", archivedTaskRef);

      const denied = parsePayload(runHook(claudeDispatch("trellis-implement")));

      expect(denied.hookSpecificOutput?.permissionDecision).toBe("deny");
      expect(denied.hookSpecificOutput?.permissionDecisionReason).toContain(
        "referenced path escapes the task archive",
      );
      expect(JSON.stringify(denied)).not.toContain(
        "SAFE_ARCHIVE_SIBLING_MUST_NOT_BE_INJECTED",
      );
      expect(JSON.stringify(denied)).not.toContain(
        "EXTERNAL_ARCHIVE_SECRET_MUST_NOT_BE_INJECTED",
      );

      // Native Codex SubagentStart is context-only and cannot use the
      // pre-dispatch gate. This probes materialization itself: the escaped
      // directory entry must be dropped as one unit, including safe.md.
      writeSession("codex", "codex-parent", archivedTaskRef);
      const native = parsePayload(
        runHook({
          hook_event_name: "SubagentStart",
          agent_type: "trellis-implement",
          session_id: "codex-parent",
          cwd: projectDir,
        }),
      );
      const context = native.hookSpecificOutput?.additionalContext ?? "";

      expect(context).toContain("# Archived Demo PRD");
      expect(context).not.toContain(
        "SAFE_ARCHIVE_SIBLING_MUST_NOT_BE_INJECTED",
      );
      expect(context).not.toContain(
        "EXTERNAL_ARCHIVE_SECRET_MUST_NOT_BE_INJECTED",
      );
    },
  );

  it.skipIf(process.platform === "win32")(
    "rejects an external directory symlink whose archived child name ends in .md",
    () => {
      const archivedTaskRef = ".trellis/tasks/archive/2026-08/demo-task";
      const archivedTaskDir = path.join(projectDir, archivedTaskRef);
      const archivedResearchDir = path.join(archivedTaskDir, "research");
      const externalDirectory = path.join(projectDir, "external-evidence");
      fs.mkdirSync(archivedResearchDir, { recursive: true });
      fs.mkdirSync(externalDirectory, { recursive: true });
      fs.writeFileSync(
        path.join(archivedTaskDir, "prd.md"),
        "# Archived Demo PRD\n",
        "utf8",
      );
      fs.writeFileSync(
        path.join(externalDirectory, "secret.md"),
        "EXTERNAL_DIRECTORY_SECRET_MUST_NOT_BE_INJECTED",
        "utf8",
      );
      fs.symlinkSync(
        externalDirectory,
        path.join(archivedResearchDir, "escaped-directory.md"),
        "dir",
      );
      fs.writeFileSync(
        path.join(archivedTaskDir, "implement.jsonl"),
        JSON.stringify({
          file: ".trellis/tasks/demo-task/research",
          type: "directory",
          reason: "archived research",
        }) + "\n",
        "utf8",
      );
      writeSession("claude", "parent", archivedTaskRef);

      const output = parsePayload(runHook(claudeDispatch("trellis-implement")));

      expect(output.hookSpecificOutput?.permissionDecision).toBe("deny");
      expect(output.hookSpecificOutput?.permissionDecisionReason).toContain(
        "referenced path escapes the task archive",
      );
      expect(JSON.stringify(output)).not.toContain(
        "EXTERNAL_DIRECTORY_SECRET_MUST_NOT_BE_INJECTED",
      );
    },
  );

  it("preserves ordinary repository directory entries outside archived self-references", () => {
    fs.writeFileSync(
      path.join(taskDir, "implement.jsonl"),
      JSON.stringify({
        file: ".trellis/spec",
        type: "directory",
        reason: "shared specs",
      }) + "\n",
      "utf8",
    );

    const output = parsePayload(runHook(claudeDispatch("trellis-implement")));

    expect(output.hookSpecificOutput?.permissionDecision).toBe("allow");
    expect(output.updated_input?.prompt).toContain(
      "=== .trellis/spec/demo.md ===",
    );
    expect(output.updated_input?.prompt).toContain("# Demo Spec");
  });

  it.each([
    ["missing", null, "manifest is missing"],
    ["empty", "", "manifest is empty"],
    ["seed-only", '{"_example":"curate me"}\n', "seed rows do not count"],
    ["malformed", '{"file":\n', "invalid JSON"],
    ["non-object", "[]\n", "entry must be a JSON object"],
    ["invalid file field", '{"file":42}\n', "non-empty string field 'file'"],
    [
      "invalid type",
      '{"file":".trellis/spec/demo.md","type":"glob"}\n',
      "type must be 'file' or 'directory'",
    ],
    [
      "missing reference",
      '{"file":".trellis/spec/missing.md","reason":"test"}\n',
      "referenced file cannot be read",
    ],
  ])(
    "denies a %s implement manifest before dispatch",
    (_name, content, expected) => {
      const manifestPath = path.join(taskDir, "implement.jsonl");
      if (content === null) fs.rmSync(manifestPath);
      else fs.writeFileSync(manifestPath, content, "utf8");

      const output = parsePayload(runHook(claudeDispatch("trellis-implement")));
      const reason = output.hookSpecificOutput?.permissionDecisionReason ?? "";

      expect(output.hookSpecificOutput?.hookEventName).toBe("PreToolUse");
      expect(output.hookSpecificOutput?.permissionDecision).toBe("deny");
      expect(output.permission).toBe("deny");
      expect(reason).toContain(expected);
      expect(reason).toContain("Curate implement.jsonl");
      expect(output.user_message).toBe(reason);
      expect(output.agent_message).toBe(reason);
      expect(output.updated_input).toBeUndefined();
    },
  );

  it("denies when any row is invalid even when another row is readable", () => {
    fs.appendFileSync(path.join(taskDir, "implement.jsonl"), "not json\n");

    const output = parsePayload(runHook(claudeDispatch("trellis-implement")));

    expect(output.hookSpecificOutput?.permissionDecision).toBe("deny");
    expect(output.hookSpecificOutput?.permissionDecisionReason).toContain(
      "invalid JSON",
    );
  });

  it("validates only the manifest for the dispatched implement/check role", () => {
    fs.writeFileSync(path.join(taskDir, "implement.jsonl"), "not json\n");

    const output = parsePayload(runHook(claudeDispatch("trellis-check")));

    expect(output.hookSpecificOutput?.permissionDecision).toBe("allow");
    expect(output.updated_input?.prompt).toContain("# Check Agent Task");
  });

  it("denies an unready check manifest independently", () => {
    fs.writeFileSync(
      path.join(taskDir, "check.jsonl"),
      '{"_example":"curate me"}\n',
    );

    const output = parsePayload(runHook(claudeDispatch("trellis-check")));

    expect(output.hookSpecificOutput?.permissionDecision).toBe("deny");
    expect(output.hookSpecificOutput?.permissionDecisionReason).toContain(
      "check.jsonl",
    );
  });

  it("denies implement/check when no active task resolves", () => {
    fs.rmSync(path.join(projectDir, ".trellis", ".runtime"), {
      recursive: true,
    });

    const output = parsePayload(runHook(claudeDispatch("trellis-implement")));

    expect(output.hookSpecificOutput?.permissionDecision).toBe("deny");
    expect(output.hookSpecificOutput?.permissionDecisionReason).toContain(
      "no active task could be resolved",
    );
  });

  it("leaves research and generic subagents outside the role-manifest gate", () => {
    fs.writeFileSync(path.join(taskDir, "implement.jsonl"), "not json\n");
    fs.writeFileSync(path.join(taskDir, "check.jsonl"), "not json\n");

    const research = parsePayload(
      runHook(claudeDispatch("trellis-research", "research the issue")),
    );
    const generic = runHook(claudeDispatch("general-purpose"));

    expect(research.hookSpecificOutput?.permissionDecision).toBe("allow");
    expect(research.updated_input?.prompt).toContain("# Research Agent Task");
    expect(generic.status).toBe(0);
    expect(generic.stdout).toBe("");
    expect(generic.stderr).toBe("");
  });

  it("ignores an ordinary non-subagent tool payload", () => {
    fs.writeFileSync(path.join(taskDir, "implement.jsonl"), "not json\n");

    const ordinaryTool = runHook({
      hook_event_name: "PreToolUse",
      tool_name: "Read",
      tool_input: {
        subagent_type: "trellis-implement",
        prompt: "inline implementation",
      },
      session_id: "parent",
      cwd: projectDir,
    });

    expect(ordinaryTool.status).toBe(0);
    expect(ordinaryTool.stdout).toBe("");
    expect(ordinaryTool.stderr).toBe("");
  });

  it("uses Cursor's documented top-level permission denial shape", () => {
    writeSession("cursor", "cursor-parent", taskRef);
    fs.writeFileSync(path.join(taskDir, "implement.jsonl"), "not json\n");

    const output = parsePayload(
      runHook(
        {
          cursor_version: "3.2.11",
          hook_event_name: "preToolUse",
          tool_name: "Subagent",
          tool_input: {
            subagent_type: { custom: { name: "trellis-implement" } },
            prompt: "implement",
          },
          conversation_id: "cursor-parent",
          cwd: projectDir,
        },
        { CURSOR_PROJECT_DIR: projectDir },
      ),
    );

    expect(output.permission).toBe("deny");
    expect(output.user_message).toContain("implement.jsonl");
    expect(output.agent_message).toBe(output.user_message);
  });

  it("uses ZCode's strict nested denial shape", () => {
    writeSession("zcode", "zcode-parent", taskRef);
    fs.writeFileSync(path.join(taskDir, "implement.jsonl"), "not json\n");

    const output = parsePayload(
      runHook(
        {
          hook_event_name: "PreToolUse",
          toolName: "Agent",
          tool_input: {
            subagent_type: "trellis-implement",
            prompt: "implement",
          },
          session_id: "zcode-parent",
          cwd: projectDir,
        },
        { ZCODE_PROJECT_DIR: projectDir },
      ),
    );

    expect(output.hookSpecificOutput?.permissionDecision).toBe("deny");
    expect(output.permission).toBeUndefined();
  });

  it("does not claim pre-dispatch denial on post-spawn host events", () => {
    fs.writeFileSync(path.join(taskDir, "implement.jsonl"), "not json\n");
    writeSession("kiro", "kiro-parent", taskRef);

    const result = runHook(
      {
        hook_event_name: "agentSpawn",
        agent_name: "trellis-implement",
        session_id: "kiro-parent",
        prompt: "implement",
        cwd: projectDir,
      },
      { KIRO_PROJECT_DIR: projectDir },
    );
    expect(result.status).toBe(0);
    const kiro = JSON.parse(result.stdout) as HookPayload;

    expect(kiro.hookSpecificOutput?.permissionDecision).not.toBe("deny");
  });
});
