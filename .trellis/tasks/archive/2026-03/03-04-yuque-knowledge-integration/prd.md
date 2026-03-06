# Integrate Yuque Knowledge Base

## Goal

Integrate Yuque (语雀) knowledge base into Trellis framework, allowing AI agents to automatically access and inject relevant documentation as context during development.

---

## Background

- Users store business knowledge, architecture designs, and requirements in private Yuque spaces
- Currently, AI agents only have access to governance rules and project code
- Need to bridge the gap between business knowledge (Yuque) and code development (Trellis)

**Reference Implementation**: `/Users/caocong/IdeaProjects/ai-governance-and-skills-starter`

---

## Requirements

### 1. Configuration Support

Support Yuque configuration in `~/.claude/settings.json`:

```json
{
  "yuque": {
    "token": "your-yuque-token",
    "repo": "https://www.yuque.com/org/repo",
    "cacheDir": "~/.cache/yuque"
  }
}
```

**Priority**: `settings.json` > environment variables (`YUQUE_TOKEN`, `YUQUE_REPO`)

### 2. CLI Command: `trellis sync-yuque`

Add a new CLI command to sync Yuque docs:

```bash
trellis sync-yuque
# or
tl sync-yuque
```

**Behavior**:
- Read config from `~/.claude/settings.json`
- Execute `yuque-dl` to download docs to `~/.cache/yuque/`
- Use `--incremental` flag for faster updates
- Report sync status (success/failure, doc count)

**Error Handling**:
- If `yuque-dl` not installed, guide user to install: `npm install -g yuque-dl`
- If config missing, show clear error message with setup instructions

### 3. Session Start Hook Integration

Modify `.claude/hooks/session-start.py` to:

1. **Optional Auto-Sync** (configurable):
   - Check if Yuque is configured
   - Optionally sync docs at session start (similar to governance sync)

2. **Keyword-Based Document Loading**:
   - Search `~/.cache/yuque/` for relevant docs
   - Filter by keywords (from task name, user request, or manual specification)
   - Inject matched docs into session context

3. **Context Injection Format**:
   ```markdown
   ## Yuque Knowledge Base

   ### [Document Title]
   [Document Content]
   ```

### 4. Document Search Strategies

Support two search modes:

**A. Keyword Search** (automatic):
- Extract keywords from task name/description
- Search document titles for matches
- Load top N relevant documents (configurable, default: 3)

**B. Manual Specification** (explicit):
- User can specify doc names in task PRD
- Example: `@yuque:WES架构设计` or `@yuque:拣货流程`

### 5. Integration with Intent Gate

Update `.trellis/spec/governance/intent-gate.md` implementation:
- When receiving development request, automatically search Yuque cache
- Inject relevant docs before AI starts planning
- Follow the existing governance rule specification (lines 15-26)

---

## Technical Design

### File Structure

```
src/
├── commands/
│   └── sync-yuque.ts          # New CLI command
├── utils/
│   ├── yuque-sync.ts          # Sync logic (reusable)
│   └── yuque-loader.ts        # Load & filter docs
└── cli/index.ts               # Register command

.claude/hooks/
└── session-start.py           # Add Yuque integration

templates/claude/hooks/
└── session-start.py           # Template source
```

### Implementation Pattern

Follow existing patterns:
- **CLI Command**: Similar to `init` and `update` commands
- **Sync Logic**: Similar to `downloadGovernanceRepo()`
- **Hook Integration**: Similar to `sync_governance_repo()`
- **Config Loading**: Similar to governance config loading

### Dependencies

- **yuque-dl**: External tool for syncing Yuque docs
  - User must install globally: `npm install -g yuque-dl`
  - Trellis executes via `execSync` or `execa`

---

## Acceptance Criteria

- [ ] `trellis sync-yuque` command works correctly
- [ ] Configuration loaded from `~/.claude/settings.json`
- [ ] Docs synced to `~/.cache/yuque/` using `yuque-dl`
- [ ] Session start hook loads and injects relevant docs
- [ ] Keyword-based search filters documents correctly
- [ ] Manual doc specification works (e.g., `@yuque:doc-name`)
- [ ] Error messages are clear and actionable
- [ ] Works with private Yuque spaces (token authentication)

---

## Testing Plan

1. **Manual Testing**:
   - Configure Yuque in settings.json
   - Run `trellis sync-yuque`
   - Verify docs in `~/.cache/yuque/`
   - Start Claude Code session
   - Verify docs injected in context

2. **Edge Cases**:
   - Missing configuration
   - Invalid token
   - Network failure
   - Empty Yuque repo
   - `yuque-dl` not installed

---

## Documentation Updates

- [ ] Update README with Yuque integration instructions
- [ ] Add configuration example to docs
- [ ] Document the `sync-yuque` command
- [ ] Update governance spec if needed

---

## Future Enhancements (Out of Scope)

- MCP server for Yuque (if available)
- Real-time sync (webhook-based)
- Document versioning
- Multi-repo support
- GUI for document selection

---

## References

- Reference implementation: `/Users/caocong/IdeaProjects/ai-governance-and-skills-starter`
- Yuque Ecosystem: https://yuque.github.io/yuque-ecosystem/#quick-start
- yuque-dl: https://github.com/yuque/yuque-dl
