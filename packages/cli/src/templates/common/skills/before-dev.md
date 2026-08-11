Read the relevant development guidelines before starting your task.

Inline execution uses this skill as the direct spec-loading gate. Inline mode intentionally skips `implement.jsonl` / `check.jsonl` curation, but it never skips applicable specs, task artifacts, review, or risk-appropriate verification.

Before loading guidelines, confirm the active development task is `in_progress` and its classified Task Basis has already passed `task.py start`. Do not turn this into a blanket Product Intent check: business features require approved Product Intent, while eligible bugfix/maintenance work may use a complete Task Basis with a concrete `NOT_REQUIRED` reason. Readonly and ordinary operational work should not enter this implementation skill merely to satisfy a development gate.

Execute these steps:

1. **Read current task artifacts**:
   - `prd.md` for requirements and acceptance criteria
   - `design.md` if present for technical design
   - `implement.md` if present for execution order and validation plan

2. **Discover packages and their spec layers**:

   ```bash
   python3 ./.trellis/scripts/get_context.py --mode packages
   ```

3. **Identify which specs apply** to your task based on:
   - Which package you're modifying (e.g., `cli/`, `docs-site/`)
   - What type of work (backend, frontend, unit-test, docs, etc.)
   - Any spec/research paths referenced by the task artifacts

4. **Read the spec index** for each relevant module:

   ```bash
   cat .trellis/spec/<package>/<layer>/index.md
   ```

   Follow the **"Pre-Development Checklist"** section in the index.

5. **Read the specific guideline files** listed in the Pre-Development Checklist that are relevant to your task. The index is NOT the goal — it points you to the actual guideline files (e.g., `error-handling.md`, `conventions.md`, `mock-strategies.md`). Read those files to understand the coding standards and patterns.

6. **Always read shared guides**:

   ```bash
   cat .trellis/spec/guides/index.md
   ```

7. Understand the coding standards and patterns you need to follow, then proceed with your development plan.

This step is **mandatory** before writing any code. If you cannot identify or load an applicable required spec, stop and report the missing context instead of treating inline mode as permission to proceed unguided.

For a Trellis-owned failure above, use the Dazz constraint voice: teach lightly for a reminder, correct directly for a strong constraint, and clearly stop on a hard gate. The first user-facing sentence of a hard stop should be Dazz's direct fatherly correction, followed by the single concrete action that unblocks work. Keep ordinary progress and check narration natural, and do not overwrite third-party or team-governance voices.

Example: `先停下。Dazz 不会让你在必需规范还没读完时动代码。先加载索引要求的规范，再继续实现。`
