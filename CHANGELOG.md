# Changelog

## 0.18.0

This release replaces tmux with pmcp's own terminal host and adds project
hooks, sessions and two MCP servers for browser and desktop use. As a 0.x minor
release it contains breaking changes.

### Breaking

- tmux is no longer used or required. Native sessions run in pmcp-pty, a PTY
  host with one daemon per harness group, and `pmcp tui` draws the workspace
  with pmcp-tui. Groups and workspaces created by 0.17 and earlier are not
  migrated: close them with the release that created them, then start a new
  one.
- The `pmcp tui` view operations (`create`, `open`, `close`, `stop` and the
  others taking `--view`) and their options are removed. `pmcp tui`,
  `plan`, `recovery`, `doctor` and `start-worker` remain.
- Harness session records hold the pmcp-pty session, host instance and
  process id instead of tmux pane identities.
- The terminal workspace and harness need Linux (glibc 2.35 or later) or
  macOS. On Linux a user systemd manager caps each session's memory; macOS
  runs sessions uncapped. Windows is not supported yet.

### Terminal host and workspace

- pmcp-pty hosts native runtimes with guarded writes, per-runtime screen
  profiles, turn detection from hook events, and a lease that refuses any
  other writer while someone holds control.
- pmcp-tui shows main, a worker dock and a coordination panel, with explicit
  control, history and mailbox views, read only until you take control.
- npm installs pmcp-pty and pmcp-tui through a platform package
  (`@modootoday/pmcp-<os>-<cpu>`) for Linux and macOS on x64 and arm64.
  `PMCP_PTY_BIN` and `PMCP_TUI_BIN` override it. The macOS binaries are
  unsigned.
- `[host]` in pmcp.toml declares which tool dialogs an operator-approved host
  may answer; login, authentication and trust prompts are never answered.
- `pmcp harness host up`, `down` and `unit` manage a host for the project.

### Browser and desktop

- pmcp-browser runs an isolated, headless Chromium over MCP that reaches
  public sites only. pmcp-desktop drives an Xvfb desktop through screenshots
  and input. Both ship in the Linux platform package; name them bare in
  `[mcp.<alias>] command` and `pmcp project` resolves the installed binary.

### Hooks, sessions and project configuration

- `[hooks]` compiles to one hook bundle projected for Claude Code, Codex,
  Gemini CLI, Grok, Antigravity and opencode, with guards for secrets,
  staging, pushes and worktrees.
- Sessions: a files-based session store, `pmcp sessions`, an addressed
  mailbox, and waking idle recipients.
- `pmcp logs` reads the project's JSONL logs, with rotation and retention set
  by `[logging]`.
- `pmcp git` creates and syncs worktrees and delivers commits to the mainline.
- `pmcp mcp` shares remote MCP authentication across runtimes.
- `pmcp status`, `pmcp init`, `pmcp hooks` and `pmcp completion` are new;
  `[permissions.claude]`, `[catalog.validation]` and declared marketplaces
  are projected from pmcp.toml.
