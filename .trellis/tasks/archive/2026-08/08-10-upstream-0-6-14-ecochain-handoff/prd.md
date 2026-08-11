# Sync upstream 0.6.14 and implement Ecochain governance handoff

## Goal

Maintenance task: adopt upstream/main at c8e327a9, preserve only required Ecochain distribution customizations, and implement the 2026-08-10 classified governance handoff. Product Intent: NOT_REQUIRED; basis is the approved handoff and upstream/fork audit.

## Task Basis

- Classification: `maintenance`
- Product Intent: `NOT_REQUIRED`
- Reason: this updates the team-owned Trellis fork and its engineering workflow; it does not introduce a business-facing product capability.
- Approved source: `/Users/caocong/IdeaProjects/2025-projects/.trellis/tmp/trellis-practice-review-20260810/03-trellis-fork-change-handoff.md`
- Upstream baseline: `upstream/main` at `c8e327a9` (package version `0.6.14`; eight commits after the `v0.6.14` tag)

## Requirements

- Apply changes in this precedence order: upstream 0.6.14, then the approved handoff, then only still-required legacy Ecochain behavior that neither duplicates upstream nor conflicts with the handoff.
- Preserve the official upstream tree as the baseline and retain only the necessary Ecochain package identity, GitLab repository/release-remote configuration, and compatible governance integration behavior.
- Keep the published package names `@ecochain/trellis` and `@ecochain/trellis-core`.
- Keep the Ecochain package version at `0.6.14`. The `@ecochain` npm scope provides package-identity isolation from upstream, so a fork-specific prerelease version is not required for this handoff.
- Use `ecochain-v<version>` as the Ecochain Git tag namespace (for this release, `ecochain-v0.6.14`). Upstream-owned `v<version>` tags remain untouched and must never identify Ecochain release contents.
- Remove the Aliyun npm registry from package metadata, workflows, documentation, release/preflight scripts, and generated manifests. Repository-owned npm commands must not inject or hard-code a registry; they must honor npm's default or user-provided configuration.
- Do not modify user-level npm configuration as part of the repository patch. A developer's current npm registry remains external machine state even when it points to Aliyun.
- Keep source metadata and the normal release path GitLab-first, including the team GitLab repository URL and the `private` release remote.
- Release automation must push only the exact tag created for the current release to `private`; it must not use `git push --tags` or otherwise copy unrelated upstream/local tags to GitLab.
- If a GitHub publish workflow is retained, it must be manual recovery only, accept only `ecochain-v*` release tags, assert that the checked-out manifests are named `@ecochain/trellis` and `@ecochain/trellis-core` before publishing, and must not publish automatically from pushes, tags, or ordinary release activity.
- Publishing to npmjs requires externally provisioned `@ecochain` scope permission and a valid `NPM_TOKEN` (or an explicitly approved equivalent). Those credentials are release prerequisites, not local implementation evidence, and must not be guessed, fabricated, or represented as verified by repository tests.
- Extend the existing natural-language workflow routing with explicit readonly, operational, business-feature, bugfix, maintenance, and review-revision classifications.
- Treat task-local `intent.md` as a Task Basis container. Require linked Product Intent only for business features; allow reasoned `NOT_REQUIRED` for bugfix and maintenance work.
- Make bootstrap creator/joiner behavior conditional on already-loaded team specs and perform a project fit/gap review instead of generating generic boilerplate.
- Keep TDD optional and risk-driven. Require credible alternative verification when a particular test type is not applicable.
- Preserve upstream JSONL manifest and Codex inline behavior; add a fail-closed gate only where sub-agent dispatch actually requires curated context.
- Define shared `ITERATION` and `MR_CANDIDATE` quality terminology without copying the GitLab MR implementation into Trellis.
- Retain the Dazz constraint voice from the completed Ecochain 0.6.8 line as a Trellis-owned presentation contract, adapted to the classified governance model rather than the discarded blanket Product Intent gate.
- Use Dazz only for Trellis-owned reminders, teaching, correction, and hard stops. Keep ordinary progress/reporting natural, preserve third-party or team-governance voices, and give one concrete next action when a hard gate blocks progress.
- Update current template truth sources and renderer/configurator tests; do not restore deleted `templates/codex/skills/**` files or the discarded July blanket Intent diff.

## Legacy customization disposition

| Legacy behavior                                                                                            | Decision                                        | Reason                                                                                                                                                 |
| ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@ecochain/*` package identity                                                                             | Retain and adapt                                | Still required for Ecochain distribution and compatible with upstream and the handoff.                                                                 |
| Team GitLab repository metadata and default `private` release remote                                       | Retain and adapt                                | Establishes the approved GitLab-first source and release path without changing upstream runtime behavior.                                              |
| GitHub publish automation                                                                                  | Restrict to manual recovery                     | GitHub is not the normal publication authority; automatic publication would create a second competing release path.                                    |
| Aliyun npm registry and related fallbacks                                                                  | Remove                                          | It is no longer required; npm must resolve the default/user registry rather than a repository-forced endpoint.                                         |
| Self-hosted/private Git template registry support                                                          | Use upstream                                    | Upstream 0.6.14 already provides Git-backed registry, GitLab/SSH, port, and nested-path support; restoring the fork implementation would duplicate it. |
| Recursive/namespaced spec discovery                                                                        | Use upstream, then extend only for handoff gaps | Current upstream hooks and context discovery cover the old base capability.                                                                            |
| Task lifecycle governance intent                                                                           | Reimplement from the handoff                    | The objective remains useful, but the old blanket gate does not match classified Task Basis semantics.                                                 |
| Global plan/intent gate and `session-gate.json` truth source                                               | Do not restore                                  | They conflict with request classification, reasoned `NOT_REQUIRED`, and the handoff's prohibition on shared workflow-state JSON as the truth source.   |
| Embedded governance-repo/Yuque sync and platform-specific review skills                                    | Do not restore in Trellis core                  | Governance content and platform executors remain owned by their registry/repositories and `ai-governance`.                                             |
| Dazz constraint voice                                                                                    | Retain and adapt                                | It is present in the completed 0.6.8 line and remains compatible when applied only as a presentation layer over the new classified governance rules.  |
| `TRELLIS_ROOT`/`.trellisroot` and other customizations absent from the completed 0.6.8 line               | Do not restore                                  | They were not retained by the prior fork integration and have no approved current requirement.                                                         |

## Acceptance Criteria

- [x] Upstream `c8e327a9` features and regression fixes remain intact and the fork history is reachable through the explicit bridge commit.
- [x] Distribution metadata still publishes `@ecochain/trellis` and `@ecochain/trellis-core`, points source/release operations at the team GitLab/private remote, and introduces no automatic GitHub publication path.
- [x] Both Ecochain package manifests retain version `0.6.14`, while Ecochain release automation creates/accepts `ecochain-v0.6.14` and does not reuse or move upstream `v0.6.14`.
- [x] The normal release path pushes only the current exact `ecochain-v<version>` tag to `private`; no release command uses `git push --tags`.
- [x] Any retained GitHub manual recovery workflow accepts only `ecochain-v*`, rejects mismatched package names before publish, and has no automatic publication trigger.
- [x] No Aliyun npm registry reference or fallback remains in package metadata, workflows, docs, release/preflight scripts, or migration/install guidance; repository-owned npm commands honor default/user registry configuration.
- [x] The repository patch does not alter user-level npm configuration; npmjs scope ownership and publish credentials are recorded as unresolved external release prerequisites until independently verified.
- [x] The package can be built, tested, linted, typechecked, and format-checked using repository-native commands.
- [x] Business features without valid Product Intent are blocked before task creation/start, while bugfix and maintenance tasks can use `NOT_REQUIRED` with a valid Task Basis.
- [x] Readonly and ordinary operational requests are not forced into development tasks.
- [x] Legacy task artifacts receive an explicit compatibility result instead of being silently treated as business features.
- [x] Creator and joiner bootstrap flows detect loaded team specs and only request evidence-backed project gaps.
- [x] Workflow/check templates describe TDD as optional and require applicable verification evidence.
- [x] Inline mode does not require JSONL; sub-agent mode rejects missing, empty, or seed-only manifests before dispatch.
- [x] `ITERATION` and `MR_CANDIDATE` share status, identity, evidence, invalidation, and fail-closed semantics while retaining separate executors.
- [x] Generated platform outputs and integration/regression tests agree with the common template truth sources.
- [x] Trellis-owned reminders, teaching, correction, and hard stops use the adapted Dazz voice across common templates and generated Claude/Codex outputs, while ordinary reporting remains natural.
- [x] Dazz hard-stop guidance reflects classified governance: business features require Product Intent, eligible bugfix/maintenance tasks require a complete Task Basis with a concrete `NOT_REQUIRED` reason, planning requires fresh start approval, and required specs must be loaded before implementation.
- [x] Readonly and ordinary operational work remain unblocked, and no Dazz wording recreates a blanket Product Intent requirement.

## Notes

- Upstream already covers most JSONL/inline semantics and natural-language routing; those areas should be adapted, not reimplemented.
- Official and fork-local `v0.6.6`–`v0.6.8` tags conflict. Use commit SHAs and remote-qualified refs when auditing releases.
