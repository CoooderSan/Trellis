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

import { existsSync, readdirSync } from "fs"
import { join, relative } from "path"
import { TrellisContext, contextCollector, debugLog } from "../lib/trellis-context.js"

const MAX_SPEC_FILES = 40
const MAX_SPEC_CHARS = 24_000
const DEFAULT_SPEC_DIRS = ["frontend", "backend", "guides"]

function formatSectionName(name) {
  if (name === "__root__") {
    return "Specs"
  }
  return name
    .replace(/[-_]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map(part => part[0].toUpperCase() + part.slice(1))
    .join(" ")
}

function hasIndexFile(directory) {
  return existsSync(join(directory, "index.md"))
}

function sectionDirSort(a, b, specRoot) {
  const aHasIndex = hasIndexFile(join(specRoot, a))
  const bHasIndex = hasIndexFile(join(specRoot, b))
  const aIsDefault = DEFAULT_SPEC_DIRS.includes(a)
  const bIsDefault = DEFAULT_SPEC_DIRS.includes(b)

  const rank = (hasIndex, isDefault, name) => {
    if (hasIndex && !isDefault) return [0, 0, name]
    if (isDefault) return [1, DEFAULT_SPEC_DIRS.indexOf(name), name]
    if (hasIndex) return [2, 0, name]
    return [3, 0, name]
  }

  const aRank = rank(aHasIndex, aIsDefault, a)
  const bRank = rank(bHasIndex, bIsDefault, b)
  return aRank[0] - bRank[0] || aRank[1] - bRank[1] || aRank[2].localeCompare(bRank[2])
}

function collectMarkdownFiles(directory) {
  if (!existsSync(directory)) {
    return []
  }

  let entries
  try {
    entries = readdirSync(directory, { withFileTypes: true })
      .filter(entry => !entry.name.startsWith("."))
  } catch {
    return []
  }

  const files = []
  const indexEntry = entries.find(entry => entry.isFile() && entry.name === "index.md")
  if (indexEntry) {
    files.push(join(directory, indexEntry.name))
  }

  const otherFiles = entries
    .filter(entry => entry.isFile() && entry.name.endsWith(".md") && entry.name !== "index.md")
    .sort((a, b) => a.name.localeCompare(b.name))
  for (const entry of otherFiles) {
    files.push(join(directory, entry.name))
  }

  const childDirs = entries
    .filter(entry => entry.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name))
  for (const entry of childDirs) {
    files.push(...collectMarkdownFiles(join(directory, entry.name)))
  }

  return files
}

function collectSpecSections(specRoot) {
  if (!existsSync(specRoot)) {
    return []
  }

  let entries
  try {
    entries = readdirSync(specRoot, { withFileTypes: true })
      .filter(entry => !entry.name.startsWith("."))
  } catch {
    return []
  }

  const sections = []

  const rootFiles = entries
    .filter(entry => entry.isFile() && entry.name.endsWith(".md"))
    .sort((a, b) => {
      if (a.name === "index.md") return -1
      if (b.name === "index.md") return 1
      return a.name.localeCompare(b.name)
    })
    .map(entry => join(specRoot, entry.name))
  if (rootFiles.length > 0) {
    sections.push({ name: formatSectionName("__root__"), files: rootFiles })
  }

  const sectionDirs = entries
    .filter(entry => entry.isDirectory())
    .sort((a, b) => sectionDirSort(a.name, b.name, specRoot))

  for (const entry of sectionDirs) {
    const files = collectMarkdownFiles(join(specRoot, entry.name))
    if (files.length > 0) {
      sections.push({ name: formatSectionName(entry.name), files })
    }
  }

  return sections
}

function appendSpecContext(parts, ctx) {
  const specRoot = join(ctx.directory, ".trellis", "spec")
  const sections = collectSpecSections(specRoot)

  let filesWritten = 0
  let charsWritten = 0
  let hasContent = false
  let truncated = false

  for (const section of sections) {
    let sectionStarted = false

    for (const filePath of section.files) {
      const content = ctx.readFile(filePath)
      if (!content) {
        continue
      }

      const relativePath = relative(specRoot, filePath).replace(/\\/g, "/")
      const entryParts = []
      if (!sectionStarted) {
        entryParts.push(`## ${section.name}`)
      }
      entryParts.push(`### ${relativePath}`)
      entryParts.push(content)
      const entryText = entryParts.join("\n\n")

      if (filesWritten >= MAX_SPEC_FILES || charsWritten + entryText.length > MAX_SPEC_CHARS) {
        truncated = true
        break
      }

      parts.push(entryText)
      hasContent = true
      sectionStarted = true
      filesWritten += 1
      charsWritten += entryText.length
    }

    if (truncated) {
      break
    }
  }

  if (!hasContent) {
    parts.push("Not configured")
  } else if (truncated) {
    parts.push(
      `[Spec context truncated after ${filesWritten} files / ${charsWritten} chars. Read additional spec files on demand.]`
    )
  }
}

/**
 * Build session context for injection
 */
function buildSessionContext(ctx) {
  const directory = ctx.directory
  const trellisDir = join(directory, ".trellis")
  const claudeDir = join(directory, ".claude")
  const opencodeDir = join(directory, ".opencode")

  const parts = []

  // 1. Header
  parts.push(`<trellis-context>
You are starting a new session in a Trellis-managed project.
Read and follow all instructions below carefully.
</trellis-context>`)

  // 2. Current Context (dynamic)
  const contextScript = join(trellisDir, "scripts", "get_context.py")
  if (existsSync(contextScript)) {
    const output = ctx.runScript(contextScript)
    if (output) {
      parts.push("<current-state>")
      parts.push(output)
      parts.push("</current-state>")
    }
  }

  // 3. Workflow Guide
  const workflow = ctx.readProjectFile(".trellis/workflow.md")
  if (workflow) {
    parts.push("<workflow>")
    parts.push(workflow)
    parts.push("</workflow>")
  }

  // 4. Guidelines
  parts.push("<guidelines>")
  appendSpecContext(parts, ctx)
  parts.push("</guidelines>")

  // 5. Session Instructions - try both .claude and .opencode
  let startMd = ctx.readFile(join(claudeDir, "commands", "trellis", "start.md"))
  if (!startMd) {
    startMd = ctx.readFile(join(opencodeDir, "commands", "trellis", "start.md"))
  }
  if (startMd) {
    parts.push("<instructions>")
    parts.push(startMd)
    parts.push("</instructions>")
  }

  // 6. Final directive
  parts.push(`<ready>
Context loaded. Wait for user's first message, then follow <instructions> to handle their request.
</ready>`)

  return parts.join("\n\n")
}

export default async ({ directory }) => {
  const ctx = new TrellisContext(directory)
  debugLog("session", "Plugin loaded, directory:", directory)

  return {
    // chat.message - triggered when user sends a message
    "chat.message": async (input) => {
      try {
        const sessionID = input.sessionID
        const agent = input.agent || "unknown"
        debugLog("session", "chat.message called, sessionID:", sessionID, "agent:", agent)

        // Skip in non-interactive mode
        if (process.env.OPENCODE_NON_INTERACTIVE === "1") {
          debugLog("session", "Skipping - non-interactive mode")
          return
        }

        // Check if we should skip (omo will handle)
        if (ctx.shouldSkipHook("session-start")) {
          debugLog("session", "Skipping - omo will handle via .claude/hooks/")
          return
        }

        // Only inject on first message
        if (contextCollector.isProcessed(sessionID)) {
          debugLog("session", "Skipping - session already processed")
          return
        }

        // Mark session as processed
        contextCollector.markProcessed(sessionID)

        // Build and store context
        const context = buildSessionContext(ctx)
        debugLog("session", "Built context, length:", context.length)

        contextCollector.store(sessionID, context)
        debugLog("session", "Context stored for session:", sessionID)

      } catch (error) {
        debugLog("session", "Error in chat.message:", error.message, error.stack)
      }
    },

    // experimental.chat.messages.transform - modify messages before sending to AI
    "experimental.chat.messages.transform": async (input, output) => {
      try {
        const { messages } = output
        debugLog("session", "messages.transform called, messageCount:", messages?.length)

        if (!messages || messages.length === 0) {
          return
        }

        // Find last user message
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

        // Get and consume pending context
        const pending = contextCollector.consume(sessionID)

        // Find first text part
        const textPartIndex = lastUserMessage.parts?.findIndex(
          p => p.type === "text" && p.text !== undefined
        )

        if (textPartIndex === -1) {
          debugLog("session", "No text part found in user message")
          return
        }

        // Prepend context to the text part (same approach as omo)
        const originalText = lastUserMessage.parts[textPartIndex].text || ""
        lastUserMessage.parts[textPartIndex].text = `${pending.content}\n\n---\n\n${originalText}`

        debugLog("session", "Injected context by prepending to text, length:", pending.content.length)

      } catch (error) {
        debugLog("session", "Error in messages.transform:", error.message, error.stack)
      }
    }
  }
}
