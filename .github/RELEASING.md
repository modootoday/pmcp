# Releasing

`.github/workflows/release.yml` builds the native binaries, packs one npm
package per platform plus the main package, and publishes them. A `v<version>`
tag matching package.json publishes, after a reviewer approves the `npm`
environment. By hand (workflow_dispatch) it never publishes: mode `dry-run`
builds and packs everything and deletes its draft release; mode `bootstrap`
keeps the draft release `v<version>` with one binary archive per target.

Neither mode runs `npm publish`, so a dry run does not test the publish step. Every path
handed to `npm publish` or `npm pack` starts with `./` or `/`: npm reads `packed/<name>.tgz`
as a GitHub `owner/repo` shorthand, which is how the first 0.18.1 tag run failed.
`__tests__/release-paths.test.ts` checks the workflow and this page for it.

## Release checklist

1. Version: set it in `package.json`, `src/commands/version.ts`, `src/mcp.ts`,
   `release-manifest.json` and each `crates/*/Cargo.toml`. Then run
   `cargo update -w` in each crate, and `cargo update -p pmcp-plugin-support` in
   the two plugin crates, whose lockfiles also record that path dependency. Run
   `bun run marketplace:build`: the plugin and extension manifests, including the
   bridge's `npx @modootoday/pmcp@<version>`, follow `package.json`.
2. `CHANGELOG.md`: turn Unreleased into the version, each line with its commit or
   pull request, plus Upgrading and Known issues when they apply.
3. Docs and site: `bun run site:build`, then `npm run docs:check`. Pushing to
   main deploys pmcp.build (`pages.yml`); `bun run site:deployed` checks it.
4. Checks: `npm run build`, `npm run typecheck`, `npm test`, and the Rust checks
   in [CONTRIBUTING.md](../CONTRIBUTING.md) for every crate.
5. Publish as below, then confirm npm serves it:
   `npm view @modootoday/pmcp@<version> version` for the main package and each
   platform package. For a few minutes after a publish, npm can show the new
   release as a `0.0.0`-stage version before the real one appears; wait and look
   again before treating it as a failed publish.

## Packages

| Package                         | Binaries                                              |
| ------------------------------- | ----------------------------------------------------- |
| `@modootoday/pmcp`              | the CLI; names the four below as optionalDependencies |
| `@modootoday/pmcp-linux-x64`    | pmcp-pty, pmcp-tui, pmcp-browser, pmcp-desktop        |
| `@modootoday/pmcp-linux-arm64`  | pmcp-pty, pmcp-tui, pmcp-browser, pmcp-desktop        |
| `@modootoday/pmcp-darwin-x64`   | pmcp-pty, pmcp-tui                                    |
| `@modootoday/pmcp-darwin-arm64` | pmcp-pty, pmcp-tui                                    |

Linux binaries are built on ubuntu-22.04 runners, so they need glibc 2.35 or
later. macOS binaries are unsigned; npm sets no quarantine flag, so they run
when installed through npm. Signing is decided when direct downloads start.

## First release (bootstrap)

npm accepts a trusted publisher only for a package that already exists, so the
first version of the platform packages is published once by a maintainer, from
a host logged in to npm, without provenance:

1. Run the release workflow by hand with mode `bootstrap` on the release
   commit. It leaves the draft release `v<version>` with
   `<target>.tar.gz` for the four targets.
2. On the maintainer host, from a clean checkout of that commit:

   ```sh
   bun install --frozen-lockfile && npm run build
   gh release download "v$(node -p 'require("./package.json").version')" --pattern '*.tar.gz' --dir bins
   for archive in bins/*.tar.gz; do
     target="$(basename "$archive" .tar.gz)"
     mkdir -p "bins/$target" && tar -C "bins/$target" -xzf "$archive"
     node scripts/platform-packages.mjs --target "$target" --bin-dir "bins/$target" --out platform
   done
   for dir in ./platform/*/; do npm publish "$dir" --access public; done
   node scripts/platform-packages.mjs --optional-dependencies > optional.json
   node -e 'const fs=require("fs");const p=JSON.parse(fs.readFileSync("package.json"));p.optionalDependencies={...p.optionalDependencies,...JSON.parse(fs.readFileSync("optional.json"))};fs.writeFileSync("package.json",JSON.stringify(p,null,2)+"\n")'
   npm publish --access public
   git checkout package.json
   ```

   The platform packages go first and the main package last, so no install
   ever names a platform version that is not on npm yet.

3. Publish the draft release, then do the one-time setup below. Every later
   version goes through the workflow with provenance.

Publishing the draft creates the tag `v<version>`, which starts the release
workflow once more. That run reuses the release and its archives, and its
publish job skips every package whose exact version is already on npm, logging
each skip, so it neither fails nor republishes.

## One-time setup (maintainer)

Publishing uses npm Trusted Publishing: npm exchanges the publish job's GitHub
OIDC token for a short-lived credential, so no npm token is stored anywhere.

1. In the GitHub repository settings, create the environment `npm` with
   required reviewers. The publish job runs in it on tag pushes.
2. On npmjs.com, for each of the five packages above, open the package
   settings, Trusted Publisher, choose GitHub Actions and enter: organization
   or user `modootoday`, repository `pmcp`, workflow filename `release.yml`,
   environment `npm`. A package must exist before a trusted publisher can be
   added, which the bootstrap above ensures.
3. Optionally, in each package's publishing access, require two-factor
   authentication and disallow tokens, so the workflow is the only way to
   publish.

The publish step installs npm 11.5.1, the first release that supports Trusted
Publishing, and publishes with `--provenance`.
