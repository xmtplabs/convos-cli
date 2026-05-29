# Automated Release Workflow Design

**Date:** 2026-05-29
**Status:** Approved
**Owner:** @insipx

## Goal

Add an automated release pipeline for `@xmtp/convos-cli` that:

- Generates versioned releases to npm without manual `npm publish` steps.
- Maintains `CHANGELOG.md` with per-PR contributor-authored entries (preserving the existing narrative voice).
- Tags releases in git and publishes GitHub Releases.
- Gates main with PR CI (typecheck + test + build) so releases inherit a green main.
- Authenticates to npm via Trusted Publishing (OIDC) — no long-lived secrets.

## Non-goals

- Replacing Renovate.
- Enforcing a changeset on every PR (advisory only; chore/docs PRs are fine without one).
- Migrating existing `CHANGELOG.md` history (Changesets prepends; old content is preserved as-is).
- Adding lint/format CI (not currently configured in repo).

## Background

Today releases are manual: contributor opens `chore/release-X.Y.Z` branch, hand-writes `CHANGELOG.md`, bumps `package.json`, merges PR, then someone runs `npm publish` locally. No CI runs on PRs or main. Two lockfiles coexist (`package-lock.json` + `pnpm-lock.yaml`).

The existing `CHANGELOG.md` has a hand-crafted narrative voice (e.g. "Breaking: attachments are always sent as remote attachments" with multi-paragraph rationale). Auto-generation from commit messages would lose this. Changesets keeps it: contributors write the changelog entry at PR time as a `.changeset/*.md` file.

Trusted Publishing was configured on the npm package settings for `xmtplabs/convos-cli` → workflow `release.yml` prior to this work.

## Architecture

```
.github/
  workflows/
    ci.yml          # PR + push: typecheck, test, build
    release.yml     # main only: open/update Version PR, publish on release commit
.changeset/
  config.json       # Changesets config
  README.md         # Contributor instructions
package.json        # + "release" script, + "packageManager", + devDeps
package-lock.json   # DELETED
```

### Tool choice

**Changesets** (`@changesets/cli` + `@changesets/changelog-github`) with the **Release-PR flow** via `changesets/action@v1`.

Rejected alternatives:

- **release-please / semantic-release**: derive changelog from commit messages → flattens the existing narrative voice.
- **Single conditional workflow**: branches release vs. CI in one file → more fragile, harder to debug.

## Components

### 1. `.github/workflows/ci.yml`

Runs on `pull_request` and `push: main`.

- Node 22 (matches `engines.node`).
- pnpm via `pnpm/action-setup` + `actions/setup-node` w/ pnpm cache.
- Steps: checkout → setup → `pnpm install --frozen-lockfile` → `pnpm typecheck` → `pnpm test` → `pnpm build`.
- Concurrency: `group: ci-${{ github.ref }}`, `cancel-in-progress: true`.

### 2. `.github/workflows/release.yml`

Runs on `push: main`.

Permissions:

```yaml
permissions:
  contents: write       # tag + GitHub Release
  pull-requests: write  # Version PR
  id-token: write       # OIDC → npm Trusted Publishing
```

Steps:

1. `actions/checkout@v4` with `fetch-depth: 0` (changesets needs history).
2. `pnpm/action-setup` (version pinned via `package.json#packageManager`).
3. `actions/setup-node@v4` with Node 22, `registry-url: https://registry.npmjs.org`, `cache: pnpm`.
4. `pnpm install --frozen-lockfile`.
5. `pnpm typecheck && pnpm test && pnpm build`.
6. `changesets/action@v1` with:
   - `publish: pnpm release`
   - `version: pnpm changeset version`
   - `title: "chore: release"`
   - `commit: "chore: release"`
   - env: `GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}`

No `NPM_TOKEN`. OIDC handled by npm CLI when `registry-url` is set + `id-token: write` is granted + Trusted Publisher is configured npm-side.

### 3. `package.json` changes

Add scripts:

```json
"release": "pnpm build && changeset publish"
```

Add `packageManager` field pinning pnpm version (run `corepack use pnpm@latest` locally to fill in).

Add devDeps:

- `@changesets/cli`
- `@changesets/changelog-github`

`prepack` script unchanged (builds + runs oclif manifest).

### 4. `.changeset/config.json`

```json
{
  "$schema": "https://unpkg.com/@changesets/config@3.0.0/schema.json",
  "changelog": ["@changesets/changelog-github", { "repo": "xmtplabs/convos-cli" }],
  "commit": false,
  "access": "public",
  "baseBranch": "main",
  "updateInternalDependencies": "patch",
  "ignore": []
}
```

### 5. `.changeset/README.md`

Boilerplate from `changesets init` plus a short note:

> Run `pnpm changeset` before merging your PR. Pick a bump level (patch/minor/major) and write the changelog entry in the same narrative voice as existing `CHANGELOG.md` entries — full sentences, explain *why*, call out breaking changes prominently.

### 6. Lockfile cleanup

Delete `package-lock.json`. Keep `pnpm-lock.yaml`. Both Renovate and CI must use pnpm only — verify `renovate.json` (no change expected; Renovate auto-detects).

### 7. Contributor flow update

Add a "Releases" section to `README.md` (or `CONTRIBUTING.md` if created) documenting:

- `pnpm changeset` per user-facing PR.
- Renovate/dependency-bump PRs typically skip changesets (batched silently into next real release).
- Releases ship by merging the bot-maintained "Version Packages" PR.

## Data flow

```
contributor PR
  ├─ writes .changeset/<slug>.md (intent + bump level)
  └─ ci.yml: typecheck/test/build → green → merge

main (post-merge of feature PR)
  └─ release.yml fires
       └─ pending changesets exist → changesets/action opens/updates "Version Packages" PR:
            - consumes .changeset/*.md
            - bumps package.json version
            - prepends CHANGELOG.md entries (grouped by bump, w/ PR links via changelog-github)
            - deletes consumed changeset files
            - commits to the release branch maintained by the action

merge "Version Packages" PR
  └─ release.yml fires again
       └─ no pending changesets, HEAD is a version commit
            - pnpm release → pnpm build && changeset publish
            - changeset publish → pnpm publish --access public (provenance auto via OIDC)
            - changesets/action: git tag vX.Y.Z + GitHub Release with changelog body
```

## Edge cases & error handling

| Case | Behavior |
|------|----------|
| Existing handwritten `CHANGELOG.md` | Changesets prepends. History from 0.10.x preserved verbatim. |
| `push: main` with no pending changesets and no version commit | action no-ops. |
| PR merged without a changeset | Not blocked. No changelog entry, no version bump triggered. Acceptable for chore/docs. |
| Publish fails after Version PR merged | Rerun `release.yml` from Actions UI. `changeset publish` is idempotent (skips already-published versions). |
| Renovate / dep-bump PRs | Default behavior: no changeset → bumps batch into next real release. No changelog noise. |
| Mixed lockfiles | Resolved by deleting `package-lock.json` in this work. |
| jj-colocated repo | Changesets writes files; works under jj. No special handling. The jj-merge skill applies if syncing the Version PR locally. |
| Branch protection blocks bot PR merge | Acceptable — human reviews + merges Version PR. |
| npm CLI version mismatch | pnpm pinned via `packageManager` ensures consistent publish behavior; OIDC handled by npm registry from any recent pnpm. |
| First release after rollout | Validate by opening one no-op changeset PR, watching Version PR appear, merging it, verifying npm dist-tag + GitHub Release + tag. |

## Setup checklist (one-time, manual)

These must be done by a repo admin **outside** the implementation PR:

1. ✅ **npm Trusted Publisher** — already configured (`xmtplabs/convos-cli` → workflow `release.yml`).
2. **GitHub Actions permissions** — Settings → Actions → General:
   - Workflow permissions: **Read and write**.
   - Check: **Allow GitHub Actions to create and approve pull requests**.
3. **Branch protection on `main`** — require `ci.yml` checks. Keep PR review requirement so a human reviews the Version PR before merge.

## Testing

- **Local dry-run**: on a feature branch, `pnpm changeset add` then `pnpm changeset version` and inspect the generated `CHANGELOG.md` diff + `package.json` bump. Revert before merging.
- **First real release**: merge a small change with a changeset, confirm `release.yml` opens a "Version Packages" PR within ~1 min, review its CHANGELOG diff, merge it, confirm:
  - `release.yml` second run publishes to npm.
  - `npm view @xmtp/convos-cli` shows new version + provenance attestation.
  - GitHub Release + git tag `vX.Y.Z` exist.

## Out of scope (future work)

- Optional GitHub Environment around the publish job (adds reviewer gate before npm publish).
- Auto-generating release notes for the GitHub Release from CHANGELOG sections (changesets/action does this by default; verify output looks right after first release).
- Lint/format CI.
- Enforcing changesets on PRs (could add `changesets/action`'s status check as required).

## References

- Changesets: https://github.com/changesets/changesets
- `changesets/action`: https://github.com/changesets/action
- npm Trusted Publishing: https://docs.npmjs.com/trusted-publishers
- Existing CHANGELOG voice: `CHANGELOG.md` entries 0.10.0–0.10.2.
