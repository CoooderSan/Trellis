---
name: trellis-spec-bootstrap
description: "Review project-specific fit and gaps in Trellis coding specs. Use for creator bootstrap or an explicit spec refresh after checking loaded registry/template guidance, then add only evidence-backed project differences."
---

# Trellis Spec Bootstrap

Use this skill to review whether the loaded `.trellis/spec/` baseline fits the
real project. Team registry/template guidance may already be complete. Start
from that baseline, inspect project-specific differences, and change specs only
when repository evidence proves a gap. The workflow does not depend on a
specific host, CLI, agent brand, or worker topology.

## Choose the Role

- **Creator bootstrap**: perform the fit/gap workflow below. A valid outcome is
  “no project-specific gaps”; do not create content merely to show activity.
- **Joiner onboarding**: read and summarize the existing specs. Do not recreate
  or rewrite project guidance. If you find a credible gap, report its evidence
  and propose separate maintenance work instead of expanding onboarding.

## Workflow

1. Confirm Trellis is initialized. Inspect `.trellis/config.yaml` for a spec
   registry/template source, then read the current `.trellis/spec/` indexes and
   relevant files.
2. Check project fit across the actual technology stack, build and verification
   commands, package/module boundaries, domain patterns, and local exceptions.
3. Analyze only suspected gaps with the best available tools: GitNexus,
   ABCoder, language tooling, and direct source reads.
4. Where evidence proves a gap, make the smallest useful spec addition or
   correction. Preserve applicable team guidance and registry ownership.
5. Verify the result. If no gap exists, record that conclusion and finish
   without modifying `.trellis/spec/`.

## Reference Routing

| Need                                      | Read                                                                   |
| ----------------------------------------- | ---------------------------------------------------------------------- |
| Repository architecture analysis          | [references/repository-analysis.md](references/repository-analysis.md) |
| Spec work decomposition and task planning | [references/spec-task-planning.md](references/spec-task-planning.md)   |
| Writing high-signal Trellis spec files    | [references/spec-writing.md](references/spec-writing.md)               |
| GitNexus and ABCoder MCP setup            | [references/mcp-setup.md](references/mcp-setup.md)                     |

## Operating Rules

- Treat loaded registry/template content as the baseline. Adapt it only for
  demonstrated project differences; do not copy an entire company or generic
  framework rulebook into the repository.
- Prefer source-backed rules over generic advice. Every important recommendation should point at a real file or repeated local pattern.
- The current agent owns integration. Optional helpers are an implementation
  detail, never a required fixed pair or user-visible workflow dependency.
- Do not write platform-specific instructions unless the target project already standardizes on that platform.
- Do not manufacture spec content, leave placeholder text, or copy boilerplate
  merely so every scaffold file appears filled.

## Done Criteria

- The loaded team guidance and project-specific differences have been reviewed.
- Each claimed gap or spec edit is backed by real source, tests, config, or
  project documentation.
- A no-gap result is allowed and is recorded explicitly.
- If files changed, `.trellis/spec/` describes the project as it exists now and
  `index.md` files match the final spec file set.
- Joiner onboarding leaves project specs unchanged.
