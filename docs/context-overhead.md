# Context Overhead Analysis

> How much context does Trellis consume? A detailed breakdown.

---

## Quick Answer

| Scenario | Tokens | 1M Window | 200k Window |
|----------|--------|-----------|-------------|
| **Session start** | ~2,300 | 0.23% | 1.15% |
| **Peak (during Implement)** | ~6,900 | 0.69% | 3.45% |
| **Full workflow cycle** | ~4,200 avg | 0.42% | 2.10% |

**Bottom line**: Trellis uses **well under 1% of 1M** or **~3.5% of 200k** context at peak. The rest is yours.

---

## How Trellis Context Works

### Key Insight: Session start is now index-first

The current SessionStart hooks inject:

- a workflow **section index** instead of the full `workflow.md`
- current project state from `get_context.py`
- task status
- relevant spec `index.md` entry files
- optional persisted session-gate summary

Detailed rule files are **not** recursively inlined anymore. They are read on demand from the injected indexes.

### Key Insight: Subagent Context is Independent

Each subagent runs with its **own isolated context**, which is discarded when it finishes:

```
Main Agent (persistent)     Subagent (temporary)
─────────────────────────   ─────────────────────
│ ~2,300 tokens          │  │ ~4,100 tokens    │
│ ├─ workflow ToC        │  │ ├─ agent prompt  │
│ ├─ current state       │  │ ├─ jsonl specs   │
│ ├─ task status         │  │ └─ prd.md        │
│ └─ spec indexes        │  └─────────────────────
│                        │       (discarded)
│ + subagent outputs     │
└─────────────────────────
```

Only the **output** from subagents accumulates in the main agent's history.

---

## Per-Agent Context Breakdown

### Main Agent (Human Interactive)

Injected at session start via `SessionStart` hook:

| Component | Tokens | 1M | 200k |
|-----------|--------|-----|------|
| workflow ToC | ~120 | 0.01% | 0.06% |
| get_context.py output | ~748 | 0.07% | 0.37% |
| task status + ready block | ~120 | 0.01% | 0.06% |
| frontend/index.md | ~335 | 0.03% | 0.17% |
| backend/index.md | ~352 | 0.04% | 0.18% |
| guides/index.md | ~586 | 0.06% | 0.29% |
| session wrapper tags / glue | ~80 | 0.01% | 0.04% |
| **Total** | **~2,341** | **0.23%** | **1.17%** |

These numbers reflect the default baseline with the standard top-level spec entry files. Current session-start hooks inject a workflow section index, current project state, task status, and the relevant spec `index.md` entry files. Default sections such as `frontend/`, `backend/`, and `guides/` remain available as fallbacks, while package-scoped indexes can be narrowed by `spec_scope` or the active task. Detailed rule files are read on demand from the injected indexes instead of being recursively inlined.

### Research Agent

Lightweight agent for codebase exploration:

| Component | Tokens | 1M | 200k |
|-----------|--------|-----|------|
| research.md (agent prompt) | ~617 | 0.06% | 0.31% |
| Project structure template | ~100 | 0.01% | 0.05% |
| Prompt wrapper | ~225 | 0.02% | 0.11% |
| research.jsonl (optional) | 0-500 | 0-0.05% | 0-0.25% |
| **Total** | **~942-1,442** | **0.09-0.14%** | **0.47-0.72%** |

### Implement Agent

Heaviest agent, carries development specs:

| Component | Tokens | 1M | 200k |
|-----------|--------|-----|------|
| implement.md (agent prompt) | ~513 | 0.05% | 0.26% |
| Prompt wrapper | ~112 | 0.01% | 0.06% |
| implement.jsonl entries | ~3,000-3,500 | 0.30-0.35% | 1.50-1.75% |
| prd.md | ~300 | 0.03% | 0.15% |
| info.md (optional) | 0-500 | 0-0.05% | 0-0.25% |
| **Total** | **~3,925-4,925** | **0.39-0.49%** | **1.96-2.46%** |

### Check Agent

Code quality verification:

| Component | Tokens | 1M | 200k |
|-----------|--------|-----|------|
| check.md (agent prompt) | ~708 | 0.07% | 0.35% |
| Prompt wrapper | ~120 | 0.01% | 0.06% |
| check.jsonl entries | ~970-1,500 | 0.10-0.15% | 0.49-0.75% |
| prd.md | ~300 | 0.03% | 0.15% |
| **Total** | **~2,098-2,628** | **0.21-0.26%** | **1.05-1.31%** |

### Debug Agent

Issue fixing specialist:

| Component | Tokens | 1M | 200k |
|-----------|--------|-----|------|
| debug.md (agent prompt) | ~483 | 0.05% | 0.24% |
| Prompt wrapper | ~130 | 0.01% | 0.07% |
| debug.jsonl entries | ~970-1,500 | 0.10-0.15% | 0.49-0.75% |
| codex-review-output.txt | 0-2,000 | 0-0.20% | 0-1.00% |
| **Total** | **~1,583-4,113** | **0.16-0.41%** | **0.79-2.06%** |

### Finish Agent

Lightweight final verification (Check agent with `[finish]` flag):

| Component | Tokens | 1M | 200k |
|-----------|--------|-----|------|
| check.md (agent prompt) | ~708 | 0.07% | 0.35% |
| Prompt wrapper | ~125 | 0.01% | 0.06% |
| finish-work.md | ~791 | 0.08% | 0.40% |
| prd.md | ~300 | 0.03% | 0.15% |
| **Total** | **~1,924** | **0.19%** | **0.96%** |

---

## Workflow Timeline

Context usage through a typical development cycle:

| Phase | Main Agent | Subagent | Peak Total | 1M | 200k |
|-------|------------|----------|------------|-----|------|
| Session start | 2,341 | - | 2,341 | 0.23% | 1.17% |
| + Research | 2,341 | 1,000 | 3,341 | 0.33% | 1.67% |
| + Research output | 2,841 | - | 2,841 | 0.28% | 1.42% |
| + Implement | 2,841 | 4,100 | **6,941** | **0.69%** | **3.47%** |
| + Implement output | 3,641 | - | 3,641 | 0.36% | 1.82% |
| + Check | 3,641 | 2,300 | 5,941 | 0.59% | 2.97% |
| + Check output | 4,241 | - | 4,241 | 0.42% | 2.12% |

**Peak usage: ~6,941 tokens** (during Implement phase)

---

## Agent Comparison Summary

| Agent | Tokens | 1M | 200k | Use Case |
|-------|--------|-----|------|----------|
| Research | ~1,000 | 0.10% | 0.50% | Codebase exploration |
| Finish | ~1,900 | 0.19% | 0.95% | Final PR check |
| Check | ~2,300 | 0.23% | 1.15% | Quality verification |
| Debug | ~2,200 | 0.22% | 1.10% | Issue fixing |
| Implement | ~4,100 | 0.41% | 2.05% | Feature development |

---

## Optimization Tips

### 1. Curate JSONL Files Carefully

Only include specs that are directly relevant:

```jsonl
// Good: task-specific specs only
{"file": ".trellis/spec/frontend/components.md"}

// Avoid: workflow.md is already in Main Agent
{"file": ".trellis/workflow.md"}  // redundant
```

### 2. Use Lightweight Agents When Possible

- Quick exploration → **Research** (~1,000 tokens)
- Final verification → **Finish** (~1,900 tokens)
- Full quality check → **Check** (~2,300 tokens)

### 3. Skip Unnecessary Phases

If you know exactly what to do:
- Skip Research, go directly to Implement
- Use Finish instead of full Check for simple tasks

### 4. Monitor JSONL File Sizes

```bash
# Check what your jsonl files reference
cat .trellis/tasks/your-task/implement.jsonl

# Measure total context
for f in $(jq -r '.file' implement.jsonl); do
  wc -c "$f"
done
```

---

## FAQ

### Q: Does context accumulate across subagent calls?

**No.** Each subagent has independent context. Only their outputs accumulate in the main agent.

### Q: What's the absolute minimum context?

**~2,300 tokens** at session start for the default index-first baseline. Package-scoped indexes or a persisted session gate summary can add a bit more, but Trellis no longer injects full nested rule trees up front.

### Q: Can I use Trellis with 32k context models?

**Yes, more comfortably now.** Peak usage (~6.9k) is about 22% of 32k. You'll still have ~25k for actual work. It is still worth disabling unused MCP servers and keeping JSONL files focused.

### Q: How does MCP affect this?

**MCP is separate.** Each MCP tool definition adds ~100-300 tokens. A server with 10 tools adds ~1,000-3,000 tokens. Disable unused servers to save context.

---

## Conclusion

| Model | Trellis Overhead | Available for Work |
|-------|------------------|-------------------|
| **1M tokens** | ~0.7% peak | **~993,059 tokens** |
| **200k tokens** | ~3.5% peak | **~193,059 tokens** |
| **128k tokens** | ~5.4% peak | **~121,059 tokens** |
| **32k tokens** | ~21.7% peak | **~25,059 tokens** |

Trellis is designed for modern large-context models. With 200k+ context, the framework overhead is small even at peak, and the index-first session-start path leaves noticeably more room for actual work.
