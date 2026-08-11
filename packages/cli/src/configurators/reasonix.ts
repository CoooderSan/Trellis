/**
 * Reasonix configurator.
 *
 * Reasonix (DeepSeek-Reasonix) stores skills as `.reasonix/skills/<name>/SKILL.md`
 * with YAML frontmatter (name + description). Slash commands are code-built-in,
 * so no commands directory is generated.
 *
 * Workflow templates are surfaced as skills with `trellis-` prefix (invocable
 * via `/skill trellis-start`, `/skill trellis-continue`, etc.).
 * Subagent skills (trellis-implement, trellis-check) use `runAs: subagent`
 * frontmatter so Reasonix spawns them as isolated subagent loops.
 */

import { AI_TOOLS } from "../types/ai-tools.js";
import { getAllAgents } from "../templates/reasonix/index.js";
import {
  collectSkillTemplates,
  resolveAllAsSkills,
  resolveBundledSkills,
} from "./shared.js";

/**
 * The Reasonix file set — written at init and diffed by `trellis update`.
 */
export function collectReasonixTemplates(): Map<string, string> {
  const config = AI_TOOLS.reasonix;
  const ctx = config.templateContext;
  const files = new Map<string, string>();

  // Subagent skill names that replace common-skill equivalents.
  const agentNames = new Set(getAllAgents().map((a) => a.name));

  // Workflow skills filtered to avoid collision with subagent skills.
  const allSkills = resolveAllAsSkills(ctx);
  const skills = allSkills.filter((s) => !agentNames.has(s.name));
  const commonCheck = allSkills.find((skill) => skill.name === "trellis-check");

  for (const [filePath, content] of collectSkillTemplates(
    ".reasonix/skills",
    skills,
    resolveBundledSkills(ctx),
  )) {
    files.set(filePath, content);
  }

  // Subagent skills (trellis-implement, trellis-check) — written with
  // runAs: subagent frontmatter for isolated subagent loops.
  for (const agent of getAllAgents()) {
    const content =
      agent.name === "trellis-check" && commonCheck
        ? `${agent.content.trimEnd()}\n\n${markdownBody(commonCheck.content)}`
        : agent.content;
    files.set(`.reasonix/skills/${agent.name}/SKILL.md`, content);
  }

  return files;
}

/** Keep Reasonix's subagent frontmatter while composing the common skill body. */
function markdownBody(content: string): string {
  const frontmatter = /^---\r?\n[\s\S]*?\r?\n---\r?\n*/;
  return content.replace(frontmatter, "").trimStart();
}
