Check if the code you just wrote follows the backend development guidelines.

Execute these steps:
1. Run `git status` to see modified files
2. Read applicable team/project rules from `.trellis/spec/**` first
3. Read `.trellis/spec/backend/index.md` to understand the default backend guidelines when they exist
4. Based on what you changed, read the relevant backend guideline files:
   - Database changes → `.trellis/spec/backend/database-guidelines.md`
   - Error handling → `.trellis/spec/backend/error-handling.md`
   - Logging changes → `.trellis/spec/backend/logging-guidelines.md`
   - Type changes → `.trellis/spec/backend/type-safety.md`
   - Any changes → `.trellis/spec/backend/quality-guidelines.md`
5. Review your code against team/project rules first, then backend defaults
6. Report any violations and fix them if found
