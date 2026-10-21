# Contributing to pmcp

pmcp is a TypeScript package (the CLI, MCP server and library, built with tsup) with five Rust
crates under `crates/` for the native binaries. Rules that agents and people both follow when
editing are in `AGENTS.md` in the repository; this page is the procedure.

## Set up

Node.js 22 or later and Bun 1.3 or later. Rust stable for the crates.

```sh
bun install --frozen-lockfile
npm run build
```

## Check a change

TypeScript, from the repository root:

```sh
npm run typecheck
npm test
npm run format:check
```

Use the package's typecheck and test scripts for code changes. Documentation changes need
link, packaging and formatting checks; avoid rebuilding unrelated runtime artifacts.

Rust, in each crate you touched (each crate builds on its own):

```sh
cargo fmt --check
cargo clippy --all-targets -j 2
cargo test -j 2
cargo check --all-targets --target aarch64-apple-darwin    # code behind cfg for macOS
cargo check --all-targets --target x86_64-pc-windows-gnu   # and for Windows
```

pmcp-pty's tests need `bash` and `python3` on PATH. The browser and desktop plugins' tests start
a real Chromium and Xvfb; their `doctor` command says what is missing. No test starts a real
agent runtime.

## Documentation

- Keep README.md focused on installation, supported features and user workflows.
- Keep detailed public configuration and integration examples in docs/.
- Keep agent instructions in AGENTS.md files next to the code they govern.

`docs/*.md` are the sources of the guide pages on pmcp.build and ship in the npm package.
Format them with prettier, then rebuild and check the site:

```sh
npx prettier --write docs/<page>.md
bun run site:build
npm run docs:check
```

## Generated files

Edit the source, then regenerate; the checks fail on a generated file edited by hand.

| Generated                                                                   | Source                                      | Command                     |
| --------------------------------------------------------------------------- | ------------------------------------------- | --------------------------- |
| `plugins/pmcp/`, the root plugin and extension manifests, `.claude-plugin/` | `skills/`, `src/ui/claude/`, `package.json` | `bun run marketplace:build` |
| `docs/<page>/index.html`, `docs/assets/`                                    | `docs/*.md`, `scripts/site/`                | `bun run site:build`        |
| `dist/`                                                                     | `src/`                                      | `npm run build`             |

## Commits and releases

Release notes are generated from commit subjects, so each subject is a line a user reads:

- `type(scope)!: summary`, with type `feat`, `fix`, `docs`, `ci`, `chore`, `test`,
  `refactor`, `perf`, `build` or `style`; the scope is optional.
- Mark a breaking change with `!` and a `BREAKING CHANGE: <what users must do>` footer, and
  add the steps to `docs/upgrading.md`.
- Say what changed for the user, not how the code changed. One logical change per commit:
  one commit is one line in the notes.

Releases follow
[RELEASING.md](https://github.com/modootoday/pmcp/blob/main/.github/RELEASING.md).
