# Compatibility

[Back to the overview](../README.md)

What runs where. Other pages link here instead of repeating requirements. What does not work yet
is on [Known issues](known-issues.md).

## Platforms

| Part                                   | Linux                                            | macOS                            | Windows       |
| -------------------------------------- | ------------------------------------------------ | -------------------------------- | ------------- |
| CLI, MCP server, `pmcp project`, hooks | yes                                              | yes                              | not qualified |
| `pmcp tui` and harness groups          | x64 and arm64, glibc 2.35 or later, user systemd | x64 and arm64, sessions uncapped | not supported |
| `pmcp harness host up` and `host unit` | user systemd manager required                    | refused                          | not supported |
| pmcp-browser and pmcp-desktop          | x64 and arm64, glibc 2.35 or later               | not shipped                      | not shipped   |

All of them need Node.js 22 or later, or Bun 1.3 or later. npm installs pmcp-pty, pmcp-tui and
(on Linux) the two plugin binaries through a platform package, `@modootoday/pmcp-<os>-<cpu>`.
`PMCP_PTY_BIN` and `PMCP_TUI_BIN` point at other builds. On Linux a user systemd manager caps
each native session's memory; macOS runs sessions without that cap. The macOS binaries are
unsigned; installed through npm they run as they are, since npm sets no quarantine flag.

## Native runtimes

| Runtime           | `[targets] tools` | `pmcp tui` and harness id | `[[host.sessions]] runtime` |
| ----------------- | ----------------- | ------------------------- | --------------------------- |
| Claude Code       | `claude`          | `claude-code`             | `claude`                    |
| Codex             | `codex`           | `codex-cli`               | `codex`                     |
| Gemini CLI        | `gemini`          | `gemini-cli`              | `gemini`                    |
| Grok Build        | `grok`            | `grok-cli`                | `grok`                      |
| Antigravity (agy) | `antigravity`     | `antigravity`             | `agy`                       |
| OpenCode          | `opencode`        | not available             | `opencode`                  |

Which hook features each runtime supports, as measured, is in
[Runtime support](hooks.md#runtime-support). Provider login, folder trust and
tool approvals stay in each runtime; pmcp never answers login, auth, trust or hook-review
prompts.

## Installation and packaging

| Surface                        | Current qualification                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CLI and MCP on Linux amd64     | Published 0.15.0 passed clean Docker installation with npm on Debian/Alpine and Bun/pnpm on Debian; 60 installation and failure contracts                                                                                                                                                                                                                                                       |
| Optional terminal workspace    | Linux pmcp-pty checks and a native Claude main with a Gemini worker (control, input, wake turns, recovery); other runtimes measured on tmux in 0.17                                                                                                                                                                                                                                             |
| Public skill installation      | npm, Bun and pnpm 10.17.1; confirmation required, scripts disabled                                                                                                                                                                                                                                                                                                                              |
| Native plugin export           | Claude, Codex, Gemini, Grok and agy formats; export does not install or activate a vendor plugin                                                                                                                                                                                                                                                                                                |
| pnpm workspace installation    | Selects the member, preserves root dependencies and updates the shared lockfile                                                                                                                                                                                                                                                                                                                 |
| Yarn skill installation        | Refused without changing project files; Yarn PnP is not supported                                                                                                                                                                                                                                                                                                                               |
| Docker profile for the harness | Codex 0.161.0 login and main/worker responses through the profile's proxy; other vendors and token refresh not measured                                                                                                                                                                                                                                                                         |
| OpenCode user-only skills      | OpenCode 1.18.33: `invocation = "user"` hides the skill from the model and keeps the `/<name>` command, measured with isolated CLI calls and scripted responses, no model call                                                                                                                                                                                                                  |
| Codex project agents           | codex-cli 0.163.0: the name a sub-agent is spawned under must be lowercase letters, digits and underscores, so pmcp writes Codex agent names with `_` for `-`. In `codex exec` the model found no way to pick a custom agent role when spawning, with or without `features.multi_agent_v2.hide_spawn_agent_metadata = false`; whether a role named with a hyphen can be picked was not measured |

Provider authentication, native children and vendor behavior have separate
qualification scopes. An installed executable or exported manifest is not proof
that every native feature works. The packed-package check, run before a
release, covers actual archive installation, CLI startup, MCP and SQLite; isolated projects
on a host are distinct from Docker and OS qualification.
