Read the backend development guidelines before starting your development task.

Execute these steps:
1. Read applicable team/project rules from `.trellis/spec/**` first.
   - If the repo contains a namespaced team/project rule set with `common/`, `develop/`, or `testing/`, treat those rules as primary.
   - For development tasks, include `common/*` and `develop/*`; add `testing/*` when the task affects tests or quality gates.
2. Read `.trellis/spec/backend/index.md` to understand the default backend guidelines when they exist.
3. Based on your task, read the relevant backend guideline files:
   - Database work → `.trellis/spec/backend/database-guidelines.md`
   - Error handling → `.trellis/spec/backend/error-handling.md`
   - Logging → `.trellis/spec/backend/logging-guidelines.md`
   - Type questions → `.trellis/spec/backend/type-safety.md`
4. Follow team/project rules first, then use backend defaults to fill in framework- or domain-specific details.
5. Then proceed with your development plan

This step is **mandatory** before writing any backend code.
