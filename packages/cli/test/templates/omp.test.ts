import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import {
  getAllAgents,
  getExtensionTemplate,
} from "../../src/templates/omp/index.js";
import { collectOmpTemplates } from "../../src/configurators/omp.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const templateDir = path.resolve(__dirname, "../../src/templates/omp");

type OmpEventHandler = (event: unknown, ctx?: unknown) => unknown;
type OmpExtension = (pi: {
  on: (event: string, handler: OmpEventHandler) => void;
}) => void;

interface OmpExtensionInternals {
  default: OmpExtension;
  buildTaskContext: (
    projectRoot: string,
    taskDir: string,
    agentType?:
      | "trellis-implement"
      | "trellis-check"
      | "trellis-research"
      | null,
  ) => string;
}

function loadOmpInternals(): OmpExtensionInternals {
  const compiled = ts.transpileModule(
    `${getExtensionTemplate()}

export { buildTaskContext };
`,
    {
      compilerOptions: {
        esModuleInterop: true,
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
  const require = createRequire(import.meta.url);
  const moduleObject: { exports: Partial<OmpExtensionInternals> } = {
    exports: {},
  };
  const sandboxProcess = Object.create(process) as NodeJS.Process;
  const sandboxEnv = { ...process.env };
  delete sandboxEnv.TRELLIS_CONTEXT_ID;
  Object.defineProperty(sandboxProcess, "env", { value: sandboxEnv });
  const sandbox = vm.createContext({
    Buffer,
    console,
    exports: moduleObject.exports,
    module: moduleObject,
    process: sandboxProcess,
    require,
  });
  vm.runInContext(compiled, sandbox);
  if (!moduleObject.exports.default || !moduleObject.exports.buildTaskContext) {
    throw new Error("OMP extension template has incomplete exports");
  }
  return moduleObject.exports as OmpExtensionInternals;
}

function loadOmpExtension(): OmpExtension {
  return loadOmpInternals().default;
}

function captureOmpHandlers(): Map<string, OmpEventHandler> {
  const handlers = new Map<string, OmpEventHandler>();
  loadOmpExtension()({
    on: (event, handler) => handlers.set(event, handler),
  });
  return handlers;
}

describe("omp templates", () => {
  it("provides the three Trellis sub-agent definitions", () => {
    const agents = getAllAgents();
    expect(agents.map((agent) => agent.name).sort()).toEqual([
      "trellis-check",
      "trellis-implement",
      "trellis-research",
    ]);
  });

  it("each agent has non-empty content and name", () => {
    for (const agent of getAllAgents()) {
      expect(agent.name.length).toBeGreaterThan(0);
      expect(agent.content.length).toBeGreaterThan(0);
    }
  });

  it("keeps child-side role validation in source and tracked agents", () => {
    const templates = collectOmpTemplates();

    for (const role of ["implement", "check"] as const) {
      const name = `trellis-${role}`;
      const source = getAllAgents().find(
        (agent) => agent.name === name,
      )?.content;
      const generated = templates.get(`.omp/agents/${name}.md`);
      const tracked = fs.readFileSync(
        path.resolve(__dirname, `../../../../.omp/agents/${name}.md`),
        "utf8",
      );

      for (const content of [source, generated, tracked]) {
        expect(content).toContain(
          `task.py validate-role-context "<task-path>" ${role}`,
        );
        expect(content?.match(/validate-role-context/g)).toHaveLength(1);
        expect(content).toContain("seed-only");
        expect(content).toContain("malformed");
        expect(content).toContain("unreadable file");
      }
    }
  });

  it("getExtensionTemplate returns a non-empty string", () => {
    const extension = getExtensionTemplate();
    expect(extension.length).toBeGreaterThan(0);
  });

  it("extension template contains key markers for OMP integration", () => {
    const extension = getExtensionTemplate();
    expect(extension).toContain("before_agent_start");
    expect(extension).toContain("input");
    expect(extension).toContain("session_start");
    expect(extension).toContain("ExtensionAPI");
  });

  it("extension template avoids known runtime and context-safety regressions", () => {
    const extension = getExtensionTemplate();

    expect(extension).not.toContain("pi.setLabel(");
    expect(extension).not.toContain("process.env.TRELLIS_CONTEXT_ID =");
    expect(extension).toContain('buildContextKey("omp", "session", sessionId)');
    expect(extension).toContain("realpathSync");
    expect(extension).toContain(
      "resolveProjectFile(projectRoot, file, trustedRoots)",
    );
    expect(extension).toContain("readFileSync(targetPath");
    expect(extension).toContain("if (!key) return null;");
    expect(extension).toContain("return key;");
    expect(extension).toContain(`if (existsSync(candidate)) {
         sessionFilePath = candidate;
      } else {
         return { status: "no_task", taskDir: null, taskTitle: null };
      }
   } else {`);
    expect(extension).toContain(
      "No identity: use single-session fallback only when there is exactly one session file.",
    );
    expect(extension).not.toContain("currentContextKey");
  });

  it("injects the derived context key into the original Bash params", () => {
    const handler = captureOmpHandlers().get("tool_call");
    if (!handler) throw new Error("OMP extension did not register tool_call");
    const params: { command: string; env?: Record<string, string> } = {
      command: "python3 ./.trellis/scripts/task.py current",
      env: { EXISTING: "kept" },
    };

    handler(
      {
        type: "tool_call",
        toolName: "bash",
        toolCallId: "call-1",
        input: params,
      },
      { sessionManager: { getSessionId: () => "session/a" } },
    );

    expect(params.env?.TRELLIS_CONTEXT_ID).toBe("omp_session_a");
    expect(params.env?.EXISTING).toBe("kept");
  });

  it("preserves an explicit Bash env override and leaves inline assignments untouched", () => {
    const handler = captureOmpHandlers().get("tool_call");
    if (!handler) throw new Error("OMP extension did not register tool_call");
    const command =
      "TRELLIS_CONTEXT_ID=inline python3 ./.trellis/scripts/task.py current";
    const params: { command: string; env?: Record<string, string> } = {
      command,
      env: { TRELLIS_CONTEXT_ID: "explicit" },
    };

    handler(
      {
        type: "tool_call",
        toolName: "bash",
        toolCallId: "call-2",
        input: params,
      },
      { sessionManager: { getSessionId: () => "session/b" } },
    );

    expect(params.command).toBe(command);
    expect(params.env?.TRELLIS_CONTEXT_ID).toBe("explicit");
  });

  it("does not mutate non-Bash tool params", () => {
    const handler = captureOmpHandlers().get("tool_call");
    if (!handler) throw new Error("OMP extension did not register tool_call");
    const params: Record<string, unknown> = { path: "README.md" };

    handler(
      {
        type: "tool_call",
        toolName: "read",
        toolCallId: "call-3",
        input: params,
      },
      { sessionManager: { getSessionId: () => "session/c" } },
    );

    expect(params).toEqual({ path: "README.md" });
  });

  it("extension template contains session context injection markers", () => {
    const extension = getExtensionTemplate();
    // R1: Session start rich injection via get_context.py
    expect(extension).toContain("buildSessionContext");
    expect(extension).toContain("trellis-session-context");
    expect(extension).toContain("get_context.py");
    expect(extension).toContain("session-context");
  });

  it("extension template contains sub-agent precision injection markers", () => {
    const extension = getExtensionTemplate();
    // R2: Sub-agent detection via PI_BLOCKED_AGENT
    expect(extension).toContain("PI_BLOCKED_AGENT");
    expect(extension).toContain("detectAgentType");
    expect(extension).toContain("trellis-implement");
    expect(extension).toContain("trellis-check");
    expect(extension).toContain("trellis-research");
    // Agent-type-specific jsonl selection
    expect(extension).toContain("implement.jsonl");
    expect(extension).toContain("check.jsonl");
  });

  it("keeps the tracked extension identical to the rendered OMP template", () => {
    const tracked = fs.readFileSync(
      path.resolve(__dirname, "../../../../.omp/extensions/trellis/index.ts"),
      "utf8",
    );
    expect(tracked).toBe(
      collectOmpTemplates().get(".omp/extensions/trellis/index.ts"),
    );
  });

  it("no settings.json or Python hooks exist in the template directory", () => {
    // OMP is extension-backed: native provider auto-discovers .omp/ subdirs,
    // so no settings.json is needed and no Python hooks should be present.
    expect(fs.existsSync(path.join(templateDir, "settings.json"))).toBe(false);
    expect(fs.existsSync(path.join(templateDir, "hooks"))).toBe(false);

    // Agents must not reference Python hook scripts
    for (const agent of getAllAgents()) {
      expect(agent.content).not.toContain("inject-subagent-context.py");
    }
  });
});

describe("omp extension role context", () => {
  function createTaskRoot(): { root: string; taskDir: string } {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "trellis-omp-context-"));
    const taskDir = path.join(root, ".trellis", "tasks", "08-11-role-gate");
    fs.mkdirSync(path.join(root, ".trellis", "spec"), { recursive: true });
    fs.mkdirSync(taskDir, { recursive: true });
    fs.writeFileSync(
      path.join(root, ".trellis", "spec", "demo.md"),
      "SPEC CONTENT",
    );
    fs.writeFileSync(path.join(taskDir, "prd.md"), "PRD CONTENT");
    fs.writeFileSync(path.join(taskDir, "design.md"), "DESIGN CONTENT");
    fs.writeFileSync(path.join(taskDir, "implement.md"), "PLAN CONTENT");
    fs.writeFileSync(path.join(taskDir, "info.md"), "LEGACY INFO CONTENT");
    return { root, taskDir };
  }

  it("loads valid role JSONL content before PRD, design, and implementation plan", () => {
    const { root, taskDir } = createTaskRoot();
    try {
      fs.writeFileSync(
        path.join(taskDir, "implement.jsonl"),
        `${JSON.stringify({ file: ".trellis/spec/demo.md", type: "file" })}\n`,
      );

      const output = loadOmpInternals().buildTaskContext(
        root,
        taskDir,
        "trellis-implement",
      );

      expect(output).toContain("SPEC CONTENT");
      expect(output).toContain("PRD CONTENT");
      expect(output).toContain("DESIGN CONTENT");
      expect(output).toContain("PLAN CONTENT");
      expect(output).not.toContain("LEGACY INFO CONTENT");
      expect(output.indexOf("SPEC CONTENT")).toBeLessThan(
        output.indexOf("PRD CONTENT"),
      );
      expect(output.indexOf("PRD CONTENT")).toBeLessThan(
        output.indexOf("DESIGN CONTENT"),
      );
      expect(output.indexOf("DESIGN CONTENT")).toBeLessThan(
        output.indexOf("PLAN CONTENT"),
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it.each([
    ["missing", null, "manifest is missing"],
    ["empty", "", "manifest is empty"],
    ["seed-only", '{"_example":"curate me"}\n', "seed rows do not count"],
    ["malformed", '{"file":\n', "invalid JSON"],
    ["non-object", "[]\n", "entry must be a JSON object"],
    [
      "invalid entry",
      '{"file":".trellis/spec/demo.md","type":"glob"}\n',
      "type must be 'file' or 'directory'",
    ],
    [
      "missing path",
      '{"file":".trellis/spec/missing.md"}\n',
      "cannot be resolved or read",
    ],
  ])("fails closed for a %s implement manifest", (_name, content, expected) => {
    const { root, taskDir } = createTaskRoot();
    try {
      if (content !== null) {
        fs.writeFileSync(path.join(taskDir, "implement.jsonl"), content);
      }
      const output = loadOmpInternals().buildTaskContext(
        root,
        taskDir,
        "trellis-implement",
      );

      expect(output).toContain('<blocked-role-context role="implement">');
      expect(output).toContain(expected);
      expect(output).toContain("validate-role-context");
      expect(output).not.toContain("PRD CONTENT");
      expect(output).not.toContain("DESIGN CONTENT");
      expect(output).not.toContain("PLAN CONTENT");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails closed when the role manifest itself is unreadable", () => {
    const { root, taskDir } = createTaskRoot();
    const manifestPath = path.join(taskDir, "implement.jsonl");
    try {
      fs.writeFileSync(
        manifestPath,
        `${JSON.stringify({ file: ".trellis/spec/demo.md" })}\n`,
      );
      fs.chmodSync(manifestPath, 0o000);
      const output = loadOmpInternals().buildTaskContext(
        root,
        taskDir,
        "trellis-implement",
      );

      expect(output).toContain('<blocked-role-context role="implement">');
      expect(output).toContain("manifest cannot be read");
      expect(output).not.toContain("PRD CONTENT");
    } finally {
      fs.chmodSync(manifestPath, 0o600);
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails closed when a valid role entry is accompanied by an invalid row", () => {
    const { root, taskDir } = createTaskRoot();
    try {
      fs.writeFileSync(
        path.join(taskDir, "check.jsonl"),
        `${JSON.stringify({ file: ".trellis/spec/demo.md" })}\nnot json\n`,
      );
      const output = loadOmpInternals().buildTaskContext(
        root,
        taskDir,
        "trellis-check",
      );

      expect(output).toContain('<blocked-role-context role="check">');
      expect(output).toContain("invalid JSON");
      expect(output).not.toContain("SPEC CONTENT");
      expect(output).not.toContain("PRD CONTENT");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails closed when a referenced role file is unreadable", () => {
    const { root, taskDir } = createTaskRoot();
    const specPath = path.join(root, ".trellis", "spec", "demo.md");
    try {
      fs.chmodSync(specPath, 0o000);
      fs.writeFileSync(
        path.join(taskDir, "check.jsonl"),
        `${JSON.stringify({ file: ".trellis/spec/demo.md" })}\n`,
      );
      const output = loadOmpInternals().buildTaskContext(
        root,
        taskDir,
        "trellis-check",
      );

      expect(output).toContain('<blocked-role-context role="check">');
      expect(output).toContain("cannot be read");
      expect(output).not.toContain("PRD CONTENT");
    } finally {
      fs.chmodSync(specPath, 0o600);
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not gate research or the main session on invalid role manifests", () => {
    const { root, taskDir } = createTaskRoot();
    try {
      fs.writeFileSync(path.join(taskDir, "implement.jsonl"), "not json\n");
      fs.writeFileSync(path.join(taskDir, "check.jsonl"), "not json\n");
      const { buildTaskContext } = loadOmpInternals();

      for (const output of [
        buildTaskContext(root, taskDir, "trellis-research"),
        buildTaskContext(root, taskDir),
      ]) {
        expect(output).not.toContain("blocked-role-context");
        expect(output).toContain("PRD CONTENT");
        expect(output).toContain("DESIGN CONTENT");
        expect(output).toContain("PLAN CONTENT");
        expect(output).not.toContain("LEGACY INFO CONTENT");
      }
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("omp command frontmatter", () => {
  it("collectOmpTemplates produces commands with YAML frontmatter", () => {
    const templates = collectOmpTemplates();
    const continueCmd = templates.get(".omp/commands/trellis-continue.md");
    const finishCmd = templates.get(".omp/commands/trellis-finish-work.md");

    expect(continueCmd).toBeDefined();
    expect(finishCmd).toBeDefined();

    // Both must start with YAML frontmatter
    expect(continueCmd).toMatch(/^---\ndescription: .+\n---\n\n/);
    expect(finishCmd).toMatch(
      /^---\ndescription: .+\nargument-hint: .+\n---\n\n/,
    );

    // Neither should retain the H1 heading from the source template
    expect(continueCmd).not.toMatch(/^---[\s\S]*?---\n\n# /);
    expect(finishCmd).not.toMatch(/^---[\s\S]*?---\n\n# /);
  });

  it("collectOmpTemplates does not emit a start command", () => {
    const templates = collectOmpTemplates();
    expect(templates.has(".omp/commands/trellis-start.md")).toBe(false);
  });

  it("keeps continuation and generated meta docs on per-dispatch JSONL and Task Basis semantics", () => {
    const templates = collectOmpTemplates();
    const continueCmd = templates.get(".omp/commands/trellis-continue.md");
    const taskSystem = templates.get(
      ".omp/skills/trellis-meta/references/local-architecture/task-system.md",
    );
    const contextLoading = templates.get(
      ".omp/skills/trellis-meta/references/customize-local/change-context-loading.md",
    );

    expect(continueCmd).toContain("JSONL readiness is not a start gate");
    expect(continueCmd).toContain("before that role dispatch");
    expect(taskSystem).toContain("Structured Task Basis");
    expect(taskSystem).toContain("--classification business-feature");
    expect(taskSystem).toContain("task.py validate-role-context");
    expect(taskSystem).not.toContain("info.md");

    expect(contextLoading).not.toContain("info.md");
    const readOrder = contextLoading?.slice(
      contextLoading.indexOf(
        "In both modes, make sure the agent ultimately reads:",
      ),
    );
    const jsonlIndex = readOrder?.indexOf("the corresponding JSONL") ?? -1;
    const prdIndex = readOrder?.indexOf("`prd.md`") ?? -1;
    const designIndex = readOrder?.indexOf("`design.md` if present") ?? -1;
    const implementIndex =
      readOrder?.indexOf("`implement.md` if present") ?? -1;
    expect(jsonlIndex).toBeGreaterThanOrEqual(0);
    expect(jsonlIndex).toBeLessThan(prdIndex);
    expect(prdIndex).toBeLessThan(designIndex);
    expect(designIndex).toBeLessThan(implementIndex);
  });
});
