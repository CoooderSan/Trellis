/* global process */
/**
 * Trellis Session Start Plugin
 *
 * Injects context when user sends the first message in a session.
 * Uses OpenCode's chat.message + experimental.chat.messages.transform hooks.
 *
 * Compatibility:
 * - If oh-my-opencode handles via .claude/hooks/, this plugin skips
 * - Otherwise, this plugin handles injection
 */

import { execFileSync } from "child_process"
import { existsSync, readdirSync } from "fs"
import { platform } from "os"
import { join } from "path"
import { TrellisContext, contextCollector, debugLog } from "../lib/trellis-context.js"

const PYTHON_CMD = platform() === "win32" ? "python" : "python3"

function normalizeTaskRef(taskRef) {
  const trimmed = String(taskRef || "").trim()
  if (!trimmed) return ""

  if (trimmed.startsWith("/") || /^[A-Za-z]:[\\/]/.test(trimmed)) {
    return trimmed
  }

  let normalized = trimmed.replace(/\\/g, "/")
  while (normalized.startsWith("./")) {
    normalized = normalized.slice(2)
  }
  if (normalized.startsWith("tasks/")) {
    return `.trellis/${normalized}`
  }
  return normalized
}

function resolveTaskDir(ctx, taskRef) {
  const normalized = normalizeTaskRef(taskRef)
  if (!normalized) return null
  if (normalized.startsWith("/") || /^[A-Za-z]:[\\/]/.test(normalized)) {
    return normalized
  }
  if (normalized.startsWith(".trellis/")) {
    return join(ctx.directory, normalized)
  }
  return join(ctx.directory, ".trellis", "tasks", normalized)
}

function getTaskStatus(ctx) {
  const taskRef = ctx.getCurrentTask()
  if (!taskRef) {
    return "Status: NO ACTIVE TASK\nNext: Describe what you want to work on"
  }

  const taskDir = resolveTaskDir(ctx, taskRef)
  if (!taskDir || !existsSync(taskDir)) {
    return `Status: STALE POINTER\nTask: ${taskRef}\nNext: Task directory not found. Run: python3 ./.trellis/scripts/task.py finish`
  }

  let taskData = {}
  const taskJsonPath = join(taskDir, "task.json")
  const taskJson = ctx.readFile(taskJsonPath)
  if (taskJson) {
    try {
      taskData = JSON.parse(taskJson)
    } catch {
      // ignore
    }
  }

  const taskTitle = taskData.title || normalizeTaskRef(taskRef)
  const taskState = taskData.status || "unknown"

  if (taskState === "completed") {
    const dirName = taskDir.split(/[\\/]/).pop()
    return `Status: COMPLETED\nTask: ${taskTitle}\nNext: Archive with \`python3 ./.trellis/scripts/task.py archive ${dirName}\` or start a new task`
  }

  let hasContext = false
  for (const jsonlName of ["implement.jsonl", "check.jsonl", "spec.jsonl"]) {
    const content = ctx.readFile(join(taskDir, jsonlName))
    if (content && content.trim()) {
      hasContext = true
      break
    }
  }

  const hasPrd = !!ctx.readFile(join(taskDir, "prd.md"))
  if (!hasPrd) {
    return `Status: NOT READY\nTask: ${taskTitle}\nMissing: prd.md not created\nNext: Write PRD, then research → init-context → start`
  }
  if (!hasContext) {
    return `Status: NOT READY\nTask: ${taskTitle}\nMissing: Context not configured (no jsonl files)\nNext: Complete Phase 2 (research → init-context → start) before implementing`
  }

  return `Status: READY\nTask: ${taskTitle}\nNext: Continue with implement or check`
}

function loadTrellisConfig(ctx) {
  const getContextScript = join(ctx.directory, ".trellis", "scripts", "get_context.py")
  if (!existsSync(getContextScript)) {
    return { isMonorepo: false, packages: {}, specScope: null, activeTaskPackage: null, defaultPackage: null }
  }

  try {
    const result = execFileSync(PYTHON_CMD, [getContextScript, "--mode", "packages", "--json"], {
      cwd: ctx.directory,
      timeout: 5000,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    })
    const data = JSON.parse(result)
    if (data.mode !== "monorepo") {
      return { isMonorepo: false, packages: {}, specScope: null, activeTaskPackage: null, defaultPackage: null }
    }
    const packages = {}
    for (const pkg of (data.packages || [])) {
      packages[pkg.name] = pkg
    }
    return {
      isMonorepo: true,
      packages,
      specScope: data.specScope || null,
      activeTaskPackage: data.activeTaskPackage || null,
      defaultPackage: data.defaultPackage || null,
    }
  } catch {
    return { isMonorepo: false, packages: {}, specScope: null, activeTaskPackage: null, defaultPackage: null }
  }
}

function checkLegacySpec(ctx, config) {
  if (!config.isMonorepo || Object.keys(config.packages).length === 0) {
    return null
  }

  const specDir = join(ctx.directory, ".trellis", "spec")
  if (!existsSync(specDir)) {
    return null
  }

  const hasLegacy = ["backend", "frontend"].some((name) => existsSync(join(specDir, name, "index.md")))
  if (!hasLegacy) {
    return null
  }

  const packageNames = Object.keys(config.packages).sort()
  const missing = packageNames.filter((name) => !existsSync(join(specDir, name)))
  if (missing.length === 0) {
    return null
  }

  if (missing.length === packageNames.length) {
    return [
      "[!] Legacy spec structure detected: found `spec/backend/` or `spec/frontend/` but no package-scoped `spec/<package>/` directories.",
      `Monorepo packages: ${packageNames.join(", ")}`,
      "Please reorganize: `spec/backend/` -> `spec/<package>/backend/`",
    ].join("\n")
  }

  return [
    `[!] Partial spec migration detected: packages ${missing.join(", ")} still missing \`spec/<pkg>/\` directory.`,
    "Please complete migration for all packages.",
  ].join("\n")
}

function resolveSpecScope(config) {
  if (!config.isMonorepo || Object.keys(config.packages).length === 0) {
    return null
  }

  const { specScope, activeTaskPackage, defaultPackage, packages } = config
  if (specScope == null) return null

  if (specScope === "active_task") {
    if (activeTaskPackage && activeTaskPackage in packages) return new Set([activeTaskPackage])
    if (defaultPackage && defaultPackage in packages) return new Set([defaultPackage])
    return null
  }

  if (Array.isArray(specScope)) {
    const valid = new Set(specScope.filter((entry) => entry in packages))
    if (valid.size > 0) return valid
    if (activeTaskPackage && activeTaskPackage in packages) return new Set([activeTaskPackage])
    if (defaultPackage && defaultPackage in packages) return new Set([defaultPackage])
  }

  return null
}

function buildWorkflowToc(workflow) {
  if (!workflow) {
    return "No workflow.md found"
  }

  const lines = [
    "# Development Workflow — Section Index",
    "Full guide: .trellis/workflow.md (read on demand)",
    "",
  ]

  for (const line of workflow.split(/\r?\n/)) {
    if (line.startsWith("## ")) {
      lines.push(line)
    }
  }

  lines.push("", "To read a section: use the Read tool on .trellis/workflow.md")
  return lines.join("\n")
}

function loadSessionGateSummary(ctx) {
  const gateScript = join(ctx.directory, ".trellis", "scripts", "session_gate.py")
  if (!existsSync(gateScript)) {
    return null
  }

  try {
    const raw = execFileSync(PYTHON_CMD, [gateScript, "show", "--json"], {
      cwd: ctx.directory,
      timeout: 5000,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    })
    const state = JSON.parse(raw)
    const status = String(state.status || "not_evaluated")
    if (status === "not_evaluated") {
      return null
    }

    const lines = [`Status: ${status.toUpperCase()}`]
    if (state.taskType) lines.push(`Task type: ${state.taskType}`)
    if (state.request) lines.push(`Request: ${state.request}`)
    if (state.summary) lines.push(`Summary: ${state.summary}`)
    if (Array.isArray(state.applicableDocs) && state.applicableDocs.length > 0) {
      lines.push("Docs:")
      for (const item of state.applicableDocs) {
        lines.push(`- ${item}`)
      }
    }
    if (Array.isArray(state.blockers) && state.blockers.length > 0) {
      lines.push("Blockers:")
      for (const item of state.blockers) {
        lines.push(`- ${item}`)
      }
    }
    if (state.nextStep) lines.push(`Next: ${state.nextStep}`)
    if (state.updatedAt) lines.push(`Updated: ${state.updatedAt}`)
    return lines.join("\n")
  } catch {
    return null
  }
}

function appendIndex(parts, title, content) {
  if (!content) return false
  parts.push(`## ${title}\n${content}`)
  return true
}

function writeGuidelineIndexes(parts, ctx, allowedPkgs) {
  const specDir = join(ctx.directory, ".trellis", "spec")
  let hasContent = false

  if (!existsSync(specDir)) {
    parts.push("Not configured")
    return
  }

  const rootIndex = ctx.readFile(join(specDir, "index.md"))
  if (rootIndex) {
    hasContent = appendIndex(parts, "spec", rootIndex) || hasContent
  }

  const guidesIndex = ctx.readFile(join(specDir, "guides", "index.md"))
  if (guidesIndex) {
    hasContent = appendIndex(parts, "guides", guidesIndex) || hasContent
  }

  let entries = []
  try {
    entries = readdirSync(specDir, { withFileTypes: true })
  } catch {
    entries = []
  }

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory() || entry.name.startsWith(".") || entry.name === "guides") {
      continue
    }

    const topName = entry.name
    const topIndex = ctx.readFile(join(specDir, topName, "index.md"))
    if (topIndex) {
      hasContent = appendIndex(parts, topName, topIndex) || hasContent

      let childEntries = []
      try {
        childEntries = readdirSync(join(specDir, topName), { withFileTypes: true })
      } catch {
        childEntries = []
      }

      for (const child of childEntries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (!child.isDirectory() || child.name.startsWith(".")) {
          continue
        }
        const childIndex = ctx.readFile(join(specDir, topName, child.name, "index.md"))
        if (childIndex) {
          hasContent = appendIndex(parts, `${topName}/${child.name}`, childIndex) || hasContent
        }
      }
      continue
    }

    if (allowedPkgs !== null && !allowedPkgs.has(topName)) {
      continue
    }

    let childEntries = []
    try {
      childEntries = readdirSync(join(specDir, topName), { withFileTypes: true })
    } catch {
      childEntries = []
    }

    for (const child of childEntries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!child.isDirectory() || child.name.startsWith(".")) {
        continue
      }
      const childIndex = ctx.readFile(join(specDir, topName, child.name, "index.md"))
      if (childIndex) {
        hasContent = appendIndex(parts, `${topName}/${child.name}`, childIndex) || hasContent
      }
    }
  }

  if (!hasContent) {
    parts.push("Not configured")
  }
}

function buildSessionContext(ctx) {
  const config = loadTrellisConfig(ctx)
  const allowedPkgs = resolveSpecScope(config)
  const parts = []

  parts.push(`<session-context>\nYou are starting a new session in a Trellis-managed project.\nRead and follow all instructions below carefully.\n</session-context>`)

  const legacyWarning = checkLegacySpec(ctx, config)
  if (legacyWarning) {
    parts.push(`<migration-warning>\n${legacyWarning}\n</migration-warning>`)
  }

  const contextScript = join(ctx.directory, ".trellis", "scripts", "get_context.py")
  if (existsSync(contextScript)) {
    const output = ctx.runScript(contextScript)
    if (output) {
      parts.push(`<current-state>\n${output.trimEnd()}\n</current-state>`)
    }
  }

  const gateSummary = loadSessionGateSummary(ctx)
  if (gateSummary) {
    parts.push(`<session-gate>\n${gateSummary}\n</session-gate>`)
  }

  parts.push(`<workflow>\n${buildWorkflowToc(ctx.readProjectFile(".trellis/workflow.md"))}\n</workflow>`)

  const guidelineParts = [
    "These are guideline indexes only. Read the specific files they reference before implementation.",
    "",
  ]
  writeGuidelineIndexes(guidelineParts, ctx, allowedPkgs)
  parts.push(`<guidelines>\n${guidelineParts.join("\n")}\n</guidelines>`)

  parts.push(`<task-status>\n${getTaskStatus(ctx)}\n</task-status>`)

  parts.push(`<ready>\nContext loaded. Workflow index, project state, guideline indexes, and any persisted session gate state are already injected above.\nWait for the user's first message, then follow the workflow.\nIf there is an active task, ask whether to continue it.\n</ready>`)

  return parts.join("\n\n")
}

export default async ({ directory }) => {
  const ctx = new TrellisContext(directory)
  debugLog("session", "Plugin loaded, directory:", directory)

  return {
    "chat.message": async (input) => {
      try {
        const sessionID = input.sessionID
        const agent = input.agent || "unknown"
        debugLog("session", "chat.message called, sessionID:", sessionID, "agent:", agent)

        if (process.env.OPENCODE_NON_INTERACTIVE === "1") {
          debugLog("session", "Skipping - non-interactive mode")
          return
        }

        if (ctx.shouldSkipHook("session-start")) {
          debugLog("session", "Skipping - omo will handle via .claude/hooks/")
          return
        }

        if (contextCollector.isProcessed(sessionID)) {
          debugLog("session", "Skipping - session already processed")
          return
        }

        contextCollector.markProcessed(sessionID)
        const context = buildSessionContext(ctx)
        debugLog("session", "Built context, length:", context.length)
        contextCollector.store(sessionID, context)
        debugLog("session", "Context stored for session:", sessionID)
      } catch (error) {
        debugLog("session", "Error in chat.message:", error.message, error.stack)
      }
    },

    "experimental.chat.messages.transform": async (_input, output) => {
      try {
        const { messages } = output
        debugLog("session", "messages.transform called, messageCount:", messages?.length)

        if (!messages || messages.length === 0) {
          return
        }

        let lastUserMessageIndex = -1
        for (let i = messages.length - 1; i >= 0; i--) {
          if (messages[i].info?.role === "user") {
            lastUserMessageIndex = i
            break
          }
        }

        if (lastUserMessageIndex === -1) {
          debugLog("session", "No user message found")
          return
        }

        const lastUserMessage = messages[lastUserMessageIndex]
        const sessionID = lastUserMessage.info?.sessionID
        debugLog("session", "Found user message, sessionID:", sessionID)

        if (!sessionID || !contextCollector.hasPending(sessionID)) {
          debugLog("session", "No pending context for session")
          return
        }

        const pending = contextCollector.consume(sessionID)
        const textPartIndex = lastUserMessage.parts?.findIndex(
          p => p.type === "text" && p.text !== undefined
        )

        if (textPartIndex === -1) {
          debugLog("session", "No text part found in user message")
          return
        }

        const originalText = lastUserMessage.parts[textPartIndex].text || ""
        lastUserMessage.parts[textPartIndex].text = `${pending.content}\n\n---\n\n${originalText}`
        debugLog("session", "Injected context by prepending to text, length:", pending.content.length)
      } catch (error) {
        debugLog("session", "Error in messages.transform:", error.message, error.stack)
      }
    }
  }
}
