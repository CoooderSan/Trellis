# Design

## Integration strategy

The feature branch starts at `upstream/main` (`c8e327a9`). Merge commit `2c3b6588` records the completed Ecochain `0.6.8` line as ancestry with the `ours` strategy while deliberately retaining the clean upstream tree. This prevents obsolete fork changes from being reintroduced automatically and allows `main` to fast-forward after review.

Required Ecochain distribution changes are reapplied as a small, auditable patch. Governance behavior is reimplemented against the current upstream task, template, and configurator architecture.

The decision order is explicit: preserve upstream 0.6.14 first, apply the approved handoff second, and only then reapply a legacy customization that remains necessary and compatible. An upstream implementation replaces an equivalent legacy implementation; historical fork ancestry is not copied mechanically.

## Distribution and remote topology

- Package identity remains `@ecochain/trellis` and `@ecochain/trellis-core`.
- Package version remains `0.6.14`. npm package identity is the pair of scope/name plus version, so `@ecochain/*@0.6.14` does not collide with the upstream package names at `0.6.14`.
- Git release identity is intentionally separate from upstream: Ecochain uses `ecochain-v<version>` (initially `ecochain-v0.6.14`), while upstream retains the `v<version>` namespace. Release checks must bind the selected tag, manifest version, and package names together.
- Repository metadata points to the team GitLab project, and release automation uses `private` as its normal remote.
- The release script pushes the branch and only the exact Ecochain tag created for that invocation. A broad `--tags` push is forbidden because the local clone also contains upstream tags that are not Ecochain releases.
- GitHub publishing, if retained, is an operator-invoked recovery path only. It accepts only `ecochain-v*`, checks that the checked-out package manifests are `@ecochain/trellis` and `@ecochain/trellis-core` before publish, and has no push, tag, scheduled, or release-event publication trigger.
- Aliyun is not an npm distribution dependency. Package manifests, documentation, workflows, release/preflight checks, and migration guidance must not hard-code it or silently fall back to it.
- Repository-owned npm subprocesses omit a forced registry and therefore inherit npm's normal precedence, including an explicit caller option, environment/user configuration, project configuration, and the npm default.
- User-level npm registry configuration is outside the repository patch boundary and is not rewritten by scripts or documentation automation. Removing repository coupling therefore does not claim that a developer's machine has already stopped using Aliyun.
- npmjs publication remains fail-closed until the `@ecochain` scope permission and `NPM_TOKEN` (or an explicitly approved equivalent) are provisioned and verified in the release environment. Local checks can validate release structure, but cannot manufacture evidence for those external prerequisites.

This keeps package identity independent from registry location: the `@ecochain` namespace does not imply a particular npm endpoint.

The release identity contract is therefore:

| Concern             | Authoritative value                                                |
| ------------------- | ------------------------------------------------------------------ |
| npm package/version | `@ecochain/trellis@0.6.14` and `@ecochain/trellis-core@0.6.14`     |
| Ecochain Git tag    | `ecochain-v0.6.14` (`ecochain-v<version>` generally)               |
| Upstream Git tag    | `v0.6.14`, preserved as an upstream reference and never repurposed |
| Normal push target  | `private`, with the current exact Ecochain tag only                |
| GitHub workflow     | Manual recovery, Ecochain tag and package-identity guarded         |
| npmjs authority     | External `@ecochain` scope permission plus release credential      |
| User npm registry   | External machine configuration, unchanged by this patch            |

## Legacy adaptation boundary

| Area                                     | Design treatment                                                                                                                                               |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Private template sources                 | Keep the upstream Git-backed registry implementation and its self-hosted GitLab/SSH/path tests; do not layer the old fork fetcher over it.                     |
| Spec discovery                           | Keep upstream shared hooks and package-context discovery; implement only bootstrap fit/gap behavior required by the handoff.                                   |
| Governance lifecycle                     | Preserve the goal, but express it through classified requests and structured Task Basis parsing on the current task architecture.                              |
| Intent enforcement                       | Replace the old global gate with class-specific rules: Product Intent for business features and reasoned `NOT_REQUIRED` for eligible maintenance/bugfix tasks. |
| Workflow state                           | Task artifacts and executable checks are authoritative; do not restore `session-gate.json` as shared truth.                                                    |
| External governance/platform integration | Keep governance content registry/template-backed and GitLab/Codeup/Sonar executors outside Trellis core.                                                       |
| Dazz constraint voice                    | Retain it as a presentation layer over Trellis-owned classified governance; do not let the voice redefine eligibility or lifecycle state.                    |
| Retired fork behavior                    | Do not restore Aliyun registry coupling, embedded governance sync, `TRELLIS_ROOT` discovery, or other changes without a current approved requirement.          |

## Dazz presentation contract

Dazz does not own governance facts. Classification, Task Basis parsing, task state, approval, and spec-loading checks remain executable rules and artifacts; Dazz determines how Trellis explains those rules to the user.

- Use a light reminder or teaching tone for recoverable guidance.
- Use a direct correction for a strong constraint.
- For a hard gate, stop clearly in the first user-facing sentence and give the single concrete action that can unblock progress.
- Recommend the safe default when one exists instead of presenting every path as equivalent.
- Keep normal investigation, progress, and check reporting natural. Do not force Dazz into every response.
- Keep third-party and team-governance instructions in their own voice.
- Adapt examples to the request class: a business feature may be blocked on Product Intent; bugfix/maintenance may be blocked on an incomplete Task Basis or vague `NOT_REQUIRED` reason; readonly and ordinary operational work do not acquire a development gate.

This preserves the 0.6.8 behavior without restoring its obsolete global Intent semantics.

## Ownership boundaries

- Trellis owns request classification, Task Basis representation, task lifecycle checks, workflow/check semantics, bootstrap routing, JSONL dispatch readiness, and the shared quality vocabulary.
- Repository build/test tools own executable quality facts.
- GitLab PR skills remain in `ai-governance`; Trellis does not copy their API, pipeline, or Sonar implementation.
- Team governance content remains registry/template-backed and is not embedded into generic Trellis templates.

## Compatibility

- Existing tasks without classification are reported as `UNKNOWN`/legacy and receive migration guidance.
- `intent.md` remains the compatibility filename but becomes a structured Task Basis container.
- Current common templates and configurator renderers are the source of truth; deleted Codex-specific generated skills stay deleted.
- Inline agents load applicable specs directly. Sub-agent dispatch requires curated JSONL entries.

## Verification

Use focused unit/integration tests for task parsing/gates, Dazz source/rendering contracts, init creator/joiner behavior, template rendering, JSONL readiness, and distribution configuration. Then run the complete CLI quality suite and inspect a fresh init/update result across representative hook and hookless platforms, including business-feature, bugfix/maintenance, readonly/operational, and check narration scenarios.
