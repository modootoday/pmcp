---
name: pmcp-release
description: Release a new pmcp version end to end - bump every version file, run the checks and the public-surface review, rehearse the release workflow in dry-run mode, confirm the npm trusted publishers, push the v<version> tag alone, have the maintainer approve the npm environment, then verify a fresh install - and recover from a failed run without moving the tag. Use when asked to release, publish, tag or bump pmcp, or when a release run is queued, failed or waiting for approval. Not for publishing a skill package or a library skill, and not for changing what pmcp does.
metadata:
  tier: open
  level: L3
  domain: agent-workflow
  install: optional
  keywords: "pmcp release, publish, npm, tag, release.yml, trusted publishing, bump version, release failed"
---

# Releasing pmcp

The procedure and its reasons are in `.github/RELEASING.md`; read it first. This skill is the
order to do it in and the mistakes that cost a release before.

## 1. Prepare on main

1. Version: `package.json`, `src/commands/version.ts`, `src/mcp.ts`, `release-manifest.json`
   and each `crates/*/Cargo.toml`. Then `cargo update -w` in each crate and
   `cargo update -p pmcp-plugin-support` in the two plugin crates (their lockfiles record that
   path dependency; a `--locked` build fails without it). Run `bun run marketplace:build`.
   Matching `0.x.y` strings in Cargo files can belong to other crates; check before changing.
2. Release notes are generated from commit subjects since the previous published release.
   Commits follow `type(scope)!: summary` (CONTRIBUTING.md); mark a breaking change with `!`
   and a `BREAKING CHANGE:` footer, and update `docs/upgrading.md` and
   `docs/known-issues.md`. Read the notes in the dry-run summary before tagging.
3. Checks, once: `bun run site:build`, `npm run build`, `npm run typecheck`, `npm test`,
   `npm run docs:check`, and in each crate `cargo fmt --check`,
   `cargo clippy --locked --all-targets` and `cargo test --locked -j 2`.
4. Review what becomes public on a `git archive` of the commit: no home paths, account names,
   hosts, tokens or private repository names in files or commit messages.
5. Push main.

## 2. Rehearse

Run the release workflow by hand in mode `dry-run` on main and wait for it to pass. It builds
every target and runs the same publish script with `npm publish --dry-run` on the same paths,
so a publish that would fail does so here. A job that stays queued for many minutes usually
names a runner image GitHub has retired: check the runner-images list and move the label.

## 3. Publish

1. Each of the five packages (the main package and the four platform packages) needs a trusted
   publisher entry on npmjs.com matching the repository, `release.yml`, the `npm` environment
   and publish permission. Confirm them right before tagging; RELEASING.md lists the fields.
2. Tag the release commit and push that tag only: `git tag v<version> <commit>` and
   `git push origin refs/tags/v<version>`. Never `git push --tags`, which pushes every local tag.
3. The publish job waits for the `npm` environment. Show the maintainer the five
   `name@version`, the commit and the run id, and approve only after they say yes in the
   conversation:
   `gh api -X POST repos/<owner>/<repo>/actions/runs/<run id>/pending_deployments -F 'environment_ids[]=<id>' -f state=approved -f comment=<why>`.
   Never approve on your own reading of the situation.
4. Right after a publish npm may show a `0.0.0`-stage version for a few minutes; wait before
   calling it failed.

## 4. Verify

In an empty directory: `npm install @modootoday/pmcp@<version>`, then
`./node_modules/.bin/pmcp --version`, `./node_modules/.bin/pmcp tui doctor` (finds pmcp-pty
and pmcp-tui in the platform package) and `npm audit`. Never run the bare name through npx:
that is another package.

## 5. When a run fails

The failed job's summary lists which packages reached npm. A transient failure (registry,
OIDC, network): `gh run rerun <run id> --failed`, then the maintainer approves again; versions
already on npm are skipped. A failure that needs a code or workflow change: never move or reuse
the tag. Fix it on main and release the next patch version.

## Report

The version, the commit, the dry-run run id and result, the tag, the publish run id, what the
maintainer approved, the fresh-install output and any failure with what was done about it.
