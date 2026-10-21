# Changelog

## Unreleased

### New

- `pmcp sessions send --to worktree:<path>` addresses the session in a linked
  worktree; `desk:<path>` keeps working. Hook messages say "linked worktree"
  and "being delivered". (152e489)
- The pmcp plugin ships the pmcp-browser and pmcp-desktop skills, so agents
  learn the two MCP servers where they are installed. (cde23e7)
- The skill tools say when to call them and what to call next. (6b71a00)
- New pages: Getting started, Run several agents, Command reference,
  Compatibility and Glossary, as Markdown in the npm package and on
  pmcp.build. (446fb90, 4f80203)

- The configuration guide is split into task pages: Hooks, Git workflow,
  Browser and desktop, and Library skills (which says how library skills are
  matched and the evidence each carries); the pmcp.toml reference keeps
  every table. Installation, Authoring and How it compares are Markdown too.
  (d29f4de, 5280cfc)
- The JSON schemas in `schema/` carry a title and a description. (1f83e4c)

### Fixes

- The release and cross-OS workflows build the Intel macOS binaries on
  `macos-15-intel`; GitHub retired the macOS 13 image, so the job never started.
- Links to a section of a guide page on pmcp.build open at that section;
  guide headings had no anchors. (446fb90)

- The pmcp plugin for Claude Code and Codex and the Gemini extension start
  the pmcp release they ship in; in 0.18.0 they still started 0.13.1.
  (0840cdc)
- `pmcp harness host up` and `host unit` stop with `platform_unsupported` on
  macOS instead of failing inside `systemd-run`. (b2d1e8d)
- The pmcp-project-init and skill-package-scaffold skills describe
  `pmcp init` and `[catalog.validation]` correctly. (44cd959)
- The pmcp.build pages no longer say the harness needs tmux, and the commands
  page lists `pmcp harness host` and `pmcp harness mcp`. (7315b23)

## 0.18.0

This release replaces tmux with pmcp's own terminal host and adds project
hooks, sessions and two MCP servers for browser and desktop use. As a 0.x minor
release it contains breaking changes. (29bad53)

### Upgrading from 0.17

Stop what 0.17 started before you upgrade; 0.18 does not read tmux groups or
views. With the 0.17 release that created them:

```sh
npx @modootoday/pmcp@0.17.4 tui recovery          # a workspace from bare pmcp: prints groupFile and generation
npx @modootoday/pmcp@0.17.4 tui close --view "$VIEW_FILE"
npx @modootoday/pmcp@0.17.4 harness group inspect --group-file "$GROUP_FILE"   # any other group: prints the generation
npx @modootoday/pmcp@0.17.4 harness group stop --group-file "$GROUP_FILE" --generation "$GENERATION"
```

Then upgrade and start a new workspace with `pmcp tui --new` (plain `pmcp`
once no 0.17 checkpoint is left). Scripts that called the removed
`pmcp tui` view operations now get a usage error (exit 2).

### Known issues

- macOS binaries are unsigned. They run when installed through npm.
  (`scripts/platform-packages.mjs`)
- Windows is not supported: the harness, `pmcp tui` and pmcp-pty stop with
  `platform_unsupported`. (`src/harness/platform.ts`)
- `pmcp harness host up` and `host unit` need Linux with a user systemd
  manager. In 0.18.0 they fail inside `systemd-run` on macOS; see Unreleased.
  (`src/harness/host/daemon.ts`)
- pmcp-browser and pmcp-desktop ship for Linux only.
  (`scripts/platform-packages.mjs`)
- The plugin for Claude Code and Codex and the Gemini extension start pmcp
  0.13.1 for skill search; install the CLI for 0.18 features. Fixed in
  Unreleased. (`scripts/marketplace/manifests.mjs`)
- `[sessions.roles]` applies to Claude Code only; Codex sends no agent type.
  (`docs/project-configuration.md`)

### Breaking

- tmux is no longer used or required. Native sessions run in pmcp-pty, a PTY
  host with one daemon per harness group, and `pmcp tui` draws the workspace
  with pmcp-tui. Groups and workspaces created by 0.17 and earlier are not
  migrated: stop them as in Upgrading from 0.17, then start a new one. (29bad53: `src/harness/adapters/terminal/`)
- The `pmcp tui` view operations (`create`, `open`, `close`, `stop` and the
  others taking `--view`) and their options are removed. `pmcp tui`,
  `plan`, `recovery`, `doctor` and `start-worker` remain. (29bad53: `src/commands/tui/invocation.ts`)
- Harness session records hold the pmcp-pty session, host instance and
  process id instead of tmux pane identities. (29bad53: `src/harness/contracts.ts`)
- The terminal workspace and harness need Linux (glibc 2.35 or later) or
  macOS. On Linux a user systemd manager caps each session's memory; macOS
  runs sessions uncapped. Windows is not supported yet. (29bad53: `src/harness/platform.ts`)

### Terminal host and workspace

- pmcp-pty hosts native runtimes with guarded writes, per-runtime screen
  profiles, turn detection from hook events, and a lease that refuses any
  other writer while someone holds control. (29bad53: `crates/pmcp-pty/`)
- pmcp-tui shows main, a worker dock and a coordination panel, with explicit
  control, history and mailbox views, read only until you take control. (29bad53: `crates/pmcp-tui/`)
- npm installs pmcp-pty and pmcp-tui through a platform package
  (`@modootoday/pmcp-<os>-<cpu>`) for Linux and macOS on x64 and arm64.
  `PMCP_PTY_BIN` and `PMCP_TUI_BIN` override it. The macOS binaries are
  unsigned. (29bad53: `scripts/platform-packages.mjs`)
- `[host]` in pmcp.toml declares which tool dialogs a host you approved may
  answer; login, authentication and trust prompts are never answered. (29bad53: `src/project/host-spec.ts`)
- `pmcp harness host up`, `down` and `unit` manage a host for the project. (29bad53: `src/commands/harness/host.ts`)

### Browser and desktop

- pmcp-browser runs an isolated, headless Chromium over MCP that reaches
  public sites only. pmcp-desktop drives an Xvfb desktop through screenshots
  and input. Both ship in the Linux platform package; name them bare in
  `[mcp.<alias>] command` and `pmcp project` resolves the installed binary. (29bad53: `crates/pmcp-plugin-browser-use/`, `crates/pmcp-plugin-computer-use/`)

### Hooks, sessions and project configuration

- `[hooks]` compiles to one hook bundle projected for Claude Code, Codex,
  Gemini CLI, Grok, Antigravity and opencode, with guards for secrets,
  staging, pushes and worktrees. (29bad53: `src/hooks/`)
- Sessions: see who else works in the repository (`pmcp sessions status`),
  pause them, send addressed messages and wake idle sessions. (29bad53: `src/sessions/`)
- `pmcp logs` reads the project's JSONL logs, with rotation and retention set
  by `[logging]`. (29bad53: `src/logging/`)
- `pmcp git` creates and syncs worktrees and delivers commits to the mainline. (29bad53: `src/git/`)
- `pmcp mcp` shares remote MCP authentication across runtimes. (29bad53: `src/mcp-auth/`)
- `pmcp status`, `pmcp init`, `pmcp hooks` and `pmcp completion` are new;
  `[permissions.claude]`, `[catalog.validation]` and declared marketplaces
  are projected from pmcp.toml. (29bad53: `src/commands/specs/inspection.ts`, `src/project/permissions.ts`)
