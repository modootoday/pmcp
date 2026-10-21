# Known issues

[Back to the overview](../README.md)

What the current release does not do yet, and what to do instead. An entry leaves this page in
the commit that fixes it, so the fix shows in that release's notes.

- macOS binaries are unsigned. They run when installed through npm, which sets no quarantine
  flag. (`scripts/platform-packages.mjs`)
- Windows is not supported: the harness, `pmcp tui` and pmcp-pty stop with
  `platform_unsupported`. (`src/harness/platform.ts`)
- `pmcp harness host up` and `host unit` need Linux with a user systemd manager; on macOS
  they refuse with `platform_unsupported`. Use `pmcp tui` or a harness group there.
  (`src/harness/platform.ts`)
- pmcp-browser and pmcp-desktop ship for Linux only. (`scripts/platform-packages.mjs`)
- `[sessions.roles]` applies to Claude Code only; Codex and the other runtimes send no agent
  type. ([Hooks](hooks.md#runtime-support))
