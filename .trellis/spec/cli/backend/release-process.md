# Release Process

> Release, versioning, docs, and npm publishing rules for the Trellis monorepo.

---

## Overview

Trellis publishes two npm packages from one git tag:

| Package                  | Role                                                             | Published by                                        |
| ------------------------ | ---------------------------------------------------------------- | --------------------------------------------------- |
| `@ecochain/trellis`      | User-facing CLI                                                  | Controlled CI; GitHub is manual npmjs recovery only |
| `@ecochain/trellis-core` | Programmatic core APIs used by the CLI and external integrations | Controlled CI; GitHub is manual npmjs recovery only |

The package pair is version-locked. Every published version must exist for both packages with the exact same version and npm dist-tag.

---

## GitLab-first, CI-only publishing

The source-of-truth repository and release push target are the GitLab `private`
remote. `packages/cli/scripts/release.js` defaults to
`TRELLIS_RELEASE_REMOTE=private`; overriding it is an explicit exceptional
operation, not the normal release path.

Official npm publishing must happen through a controlled CI executor. The
repository does not yet contain a GitLab publishing pipeline, so
`.github/workflows/publish.yml` is temporarily retained as a **manual recovery
executor**. It has no tag/release trigger: first mirror the already-reviewed
GitLab tag to GitHub, then explicitly dispatch the workflow with that existing
tag. GitHub is not the development primary or the release push target.

Do not run `npm publish` or `pnpm publish` locally for official Trellis packages. Local machines may run `pnpm pack`, `release-preflight`, tests, lint, typecheck, and dry-run checks, but not package publication.

If a CI publish looks partial or inconsistent:

1. Inspect the controlled publish run and confirm it checked out the intended GitLab-originated tag.
2. Verify package visibility using npm's active configuration:
   ```bash
   npm view @ecochain/trellis@<version> version dist-tags --json
   npm view @ecochain/trellis-core@<version> version dist-tags --json
   ```
3. Fix the workflow or release scripts.
4. Re-run the CI path or move the tag after the fix when the same version is still the intended release artifact.

Do not compensate by publishing one missing package locally. That creates a release artifact without CI provenance and hides the workflow failure from the next release.

The publish workflow must verify both packages after publish with:

```bash
node packages/cli/scripts/release-preflight.js verify-npm --package all
```

---

## Version invariants

| Invariant           | Rule                                                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Shared version      | `packages/cli/package.json` and `packages/core/package.json` must have the same `version`.                                |
| Shared tag          | Ecochain Git tag `ecochain-v<version>` must match both package versions. Upstream `v<version>` tags are never repurposed. |
| Shared npm dist-tag | `beta` for `-beta.N`, `rc` for `-rc.N`, `alpha` for `-alpha.N`, `latest` for GA.                                          |
| Source dependency   | CLI source depends on core with `workspace:*`.                                                                            |
| Packed dependency   | Published CLI package must depend on `@ecochain/trellis-core` with the exact release version.                             |

`packages/cli/scripts/release-preflight.js` is the source of truth for these checks.

Required gates:

```bash
node packages/cli/scripts/release-preflight.js check-versions
node packages/cli/scripts/release-preflight.js verify-packed-cli
node packages/cli/scripts/release-preflight.js publish-plan
```

---

## Branch and release tracks

| Track        | Branch pattern                                          | Version pattern | npm tag  | Notes                                                                  |
| ------------ | ------------------------------------------------------- | --------------- | -------- | ---------------------------------------------------------------------- |
| Stable       | `main`                                                  | `X.Y.Z`         | `latest` | Patch/minor/major GA releases.                                         |
| Beta         | `feat/vX.Y.Z-beta` or equivalent long-lived beta branch | `X.Y.Z-beta.N`  | `beta`   | Feature incubation. CLI and core both publish beta versions.           |
| RC           | release candidate branch or the stabilized beta branch  | `X.Y.Z-rc.N`    | `rc`     | Pre-GA validation. CLI and core both publish rc versions.              |
| GA promotion | stable release branch / `main`                          | `X.Y.Z`         | `latest` | Promote the release candidate into the stable docs and latest npm tag. |

A new beta cycle starts from the current stable/release baseline and uses the next minor or major version, for example `0.6.0-beta.0` after `0.5.x`. It does not continue an older beta line after that line has moved to RC or GA.

Stable fixes normally flow from `main` to beta/rc by cherry-pick. Beta-only features do not flow back to `main` by cherry-pick; rewrite them as stable-ready commits when needed.

---

## Docs-site lifecycle

The docs-site root path holds the current stable docs. Beta and RC content live under `beta/` and `rc/`.

| Transition       | Script                                 | When                                                                                    |
| ---------------- | -------------------------------------- | --------------------------------------------------------------------------------------- |
| Start a new beta | `docs-site/scripts/docs-beta-start.sh` | Before the first `pnpm release:beta` for a new minor/major, for example `0.6.0-beta.0`. |
| Beta to RC       | `docs-site/scripts/docs-beta-to-rc.sh` | Before the first `pnpm release:rc`, for example `0.6.0-rc.0`.                           |
| RC to GA         | `docs-site/scripts/docs-promote.sh`    | Before `pnpm release:promote`.                                                          |

Per-patch beta, RC, or GA releases do not run these lifecycle scripts. They add changelog MDX files, update `docs-site/docs.json`, commit the docs-site submodule first, then bump the submodule pointer in the main repo.

Full docs details live in `.trellis/spec/docs-site/docs/release-lifecycle.md`.

---

## Submodule commit ordering

When a release touches `docs-site` or `marketplace`, commit and push the
submodule to its team-owned primary remote first, then commit the submodule
pointer in the main repo. Do not bump a pointer while the only writable target
is an upstream GitHub repository the team does not own.

Correct order:

```bash
cd docs-site
git add . && git commit -m "docs: changelog v<version>"
git push <team-submodule-remote> main

cd ..
git add docs-site
git commit -m "chore: bump docs-site for v<version>"
git push private <branch>
```

`packages/cli/scripts/release.js` excludes `docs-site` and `marketplace` from its automatic pre-release staging so submodule pointer changes cannot be hidden inside a generic release commit.

### Contract: every modified submodule must be pushed before the version tag

The controlled publish executor runs `git submodule update --init --recursive` against the selected tagged commit. If **any** submodule pointer references a SHA that doesn't exist on the submodule's remote, CI fails at checkout with:

```
fatal: remote error: upload-pack: not our ref <SHA>
fatal: Fetched in submodule path '<name>', but it did not contain <SHA>. Direct fetching of that commit failed.
```

This is per-submodule. Pushing `docs-site` but forgetting `marketplace` (or vice versa) still fails. Verify all submodules before `pnpm release`:

```bash
git submodule foreach 'remote=<team-submodule-remote>; git fetch "$remote" -q; sha=$(git rev-parse HEAD); \
  git merge-base --is-ancestor $sha "$remote/main" \
    && echo "ok $name" || echo "FAIL $name $sha not on remote"'
```

### Don't: test submodule reachability with `ls-remote`

**Problem**:

```bash
git submodule foreach 'sha=$(git rev-parse HEAD); git ls-remote origin $sha | grep -q $sha && ...'
```

**Why it's bad**: `ls-remote` matches **ref names**, not commits. It finds a SHA
only when that SHA is itself a branch or tag tip. A submodule pointer at any
earlier commit on `main` — which is the normal case, since pointers are bumped
after the submodule moves on — reports `FAIL` while CI fetches it without
trouble. Observed 2026-08-06 while preparing v0.6.13: both submodules reported
`FAIL`, both were reachable.

A check that fails on healthy input is worse than no check. It trains you to
ignore it, which is how the v0.6.4 incident below happens a second time.

**Instead**: fetch, then ask whether the SHA is an ancestor of the remote branch
— that is the same question CI answers when it materialises the pointer.

Any `FAIL` line means: provision or select the team-owned submodule remote,
push the referenced commit there, verify reachability, and only then bump/tag
the parent repository. If no such writable remote exists, the parent pointer
change is blocked; do not create a local-only submodule commit.

> **Incident note (2026-06, v0.6.4).** `marketplace/workflows/native/workflow.md` was touched as a parity mirror for a bundled template edit, committed in-submodule, and pointer-bumped in the main repo — but the submodule itself was never pushed to its `origin/main`. `pnpm release` happily tagged `v0.6.4`; CI fetched the new tag, tried to materialise the marketplace pointer `680bcbb`, and died at checkout. Fix took two commands (`git -C marketplace push origin main` + `gh run rerun --failed`) but the failure mode is invisible from main-repo `git status` (the submodule is "clean" locally), which is exactly why the verify step above is mandatory and not advisory.

### Contract: the pre-release sweep MUST exclude `.trellis/`

The pre-release `git add` in `release.js` (the `chore: pre-release updates`
commit) **must** exclude `.trellis/` from its pathspec, alongside `docs-site`
and `marketplace`:

```js
run("git add -A -- ':!docs-site' ':!marketplace' ':!.trellis'");
```

`.trellis/tasks/` is not gitignored, so a blanket `git add -A` sweeps in any
dirty in-progress task dirs, workspace journal drafts, and runtime artifacts
that happen to be present in the release session. Staging `.trellis/` is only
ever allowed through `common/safe_commit.py`'s precise allowlist (see the
"unscoped `.trellis` staging" bug class in `script-conventions.md`) — never
through a release-time blanket stage.

> **Incident note (2026-06, #303).** A `release.js` pre-release `git add -A`
> that excluded only `docs-site`/`marketplace` swept 6 unrelated in-progress
> community-governance task files into the pre-release commit twice
> (`5ee43ecc`, `ec123deb`). The maintainer had to `git rm --cached` three
> times (`d66405d9`, `81960120`, `3c3219cf`) before finally tracking the
> drafts to stop the bleed (`e83233c9`). The same staging-scope defect also
> lives in `add_session.py` (the #303 body) and in ad-hoc human/AI
> `git add -A`. This contract exists so the release route can never re-open
> that escape hatch. See `script-conventions.md` → "Absolute prohibition:
> never blanket-stage" for the full bug-class writeup.

---

## Manifest continuity across branches

Each release branch maintains its own `packages/cli/src/migrations/manifests/<version>.json`. The CLI update logic walks the manifest chain between `fromVersion` and `toVersion`, so every published version that a user can upgrade through must have a local manifest on the release branch.

When a stable patch manifest is missing from a beta branch:

```bash
git show main:packages/cli/src/migrations/manifests/<version>.json \
  > packages/cli/src/migrations/manifests/<version>.json
git add packages/cli/src/migrations/manifests/<version>.json
git commit -m "chore: restore manifest <version> from main"
```

Restore published manifests deliberately. Do not auto-merge whole manifest directories across release branches, because branch-specific manifests can mention files that do not exist on the other branch.

---

## Release command sequence

The root release scripts delegate to the CLI package:

```bash
pnpm release
pnpm release:beta
pnpm release:rc
pnpm release:promote
```

`packages/cli/scripts/release.js` runs:

1. `check-manifest-continuity`
2. `check-docs-changelog --type beta|rc|promote` for prerelease/promotion tracks
3. core tests
4. CLI tests
5. pre-release commit excluding `docs-site`, `marketplace`, and `.trellis`
6. `bump-versions.js <type>` to update both package versions together
7. `release-preflight check-versions`
8. version commit with the version string as the commit message
9. git tag `ecochain-v<version>`
10. push the branch, then only the exact `ecochain-v<version>` tag, to the GitLab `private` remote; never use `git push --tags`
11. mirror the reviewed tag to GitHub only when publishing or mirroring is intentionally requested
12. manually dispatch the retained GitHub recovery workflow, or use a future team-owned GitLab CI executor, to build, test, pack, publish, and verify both packages

The release script does not publish locally. The pushed GitLab tag establishes
the immutable release-candidate identity; publication begins only when a
maintainer explicitly starts the controlled executor for that tag.

---

## Publish workflow sequence

`.github/workflows/publish.yml` is manually dispatched with an existing
`ecochain-v*` tag after that exact tag has been mirrored from GitLab. It is an
npmjs recovery executor, is idempotent for reruns on the same tag, and must
remain non-triggering so mirroring cannot publish by accident.

Required order:

1. validate the `ecochain-v*` input, checkout `refs/tags/<input>`, and assert the exact tag commit is checked out
2. assert both manifest names are exactly `@ecochain/trellis` and `@ecochain/trellis-core`
3. install dependencies
4. `release-preflight check-versions --require-tag`
5. `pnpm typecheck`
6. `pnpm build`
7. `pnpm test`
8. `release-preflight verify-packed-cli`
9. `release-preflight publish-plan --github`
10. publish `@ecochain/trellis-core` to npmjs if missing
11. publish `@ecochain/trellis` to npmjs if missing
12. `release-preflight verify-npm --package all`

Core publishes first because the CLI package depends on the exact core version in the packed artifact.

---

## Artifact verification for release-claimed assets

Any changelog, docs page, or marketplace entry that says a feature is "bundled",
"installed automatically", or "included with Trellis" must be verified against
the built package artifact, not only against the source tree.

Before tagging a release that adds or changes a bundled template, skill,
workflow, hook, script, or generated platform asset:

1. Run the CLI build.
2. Run `npm pack --dry-run --json` from `packages/cli/` and check the expected
   `dist/templates/**` paths are present.
3. Use the built binary (`node packages/cli/bin/trellis.js`) in a fresh temp
   git repository and run the user-facing command that should install the
   asset.
4. Check both the generated files and `.trellis/.template-hashes.json` for the
   expected paths.
5. Run `trellis update --dry-run` from the temp repository and confirm it
   reports the project is already up to date.

This gate is required when docs are updated before or separately from the code
branch that actually adds the distributable files. A source file existing on
another branch, in `marketplace/`, or in a docs submodule is not evidence that
the npm package contains it.

Example for a built-in multi-file skill:

```bash
pnpm --filter @ecochain/trellis build

cd packages/cli
npm pack --dry-run --json | grep 'dist/templates/common/bundled-skills/<skill>/SKILL.md'
cd ../..

tmpdir=$(mktemp -d /tmp/trellis-release-smoke-XXXXXX)
printf '{"name":"trellis-smoke","version":"0.0.0"}\n' > "$tmpdir/package.json"
git -C "$tmpdir" init -q
(
  cd "$tmpdir"
  node /path/to/Trellis/packages/cli/bin/trellis.js init -u smoke --yes --claude --codex
  test -f .claude/skills/<skill>/SKILL.md
  test -f .agents/skills/<skill>/SKILL.md
  grep -q '<skill>' .trellis/.template-hashes.json
  node /path/to/Trellis/packages/cli/bin/trellis.js update --dry-run
)
```

---

## Pre-release checklist

- [ ] Worktree is clean except intentional release changes.
- [ ] Relevant coding specs have been read.
- [ ] Manifest exists for the target version.
- [ ] English and Chinese docs-site changelogs exist and match 1:1.
- [ ] `docs-site/docs.json` points to the new changelog.
- [ ] Submodule commits are pushed before main repo pointer commits.
- [ ] `node packages/cli/scripts/release-preflight.js check-versions` passes.
- [ ] `node packages/cli/scripts/release-preflight.js verify-packed-cli` passes.
- [ ] Release-claimed bundled assets are verified in `npm pack --dry-run --json` and a fresh temp-directory `trellis init` / `trellis update --dry-run` smoke test.
- [ ] `pnpm lint && pnpm typecheck && pnpm test` pass or the blocker is recorded.
- [ ] Breaking releases include `migrationGuide` and `aiInstructions` in the manifest.
- [ ] Release branch and only the exact current `ecochain-v<version>` tag were pushed to GitLab `private`, not GitHub.
- [ ] Any GitHub tag used for publication was mirrored from the reviewed GitLab tag.
- [ ] Official package publication is left to the controlled CI executor.
- [ ] npmjs `@ecochain` scope permission and `NPM_TOKEN` are provisioned and independently verified in the recovery executor; local tests do not prove these external prerequisites.

---

## Cross-references

- Core/CLI code ownership and package boundaries: `trellis-core-sdk.md`
- Manifest format and migration types: `migrations.md`
- Docs lifecycle: `.trellis/spec/docs-site/docs/release-lifecycle.md`
- Native dependency policy: `quality-guidelines.md`
