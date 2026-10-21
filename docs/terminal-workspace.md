# Terminal workspace

Use `pmcp tui` to view a main runtime and its workers in one terminal. The main
conversation stays in its native interface. PMCP adds a worker dock, a
coordination panel and explicit control switching. Provider login, folder trust
and tool approvals stay in their native screens. Sessions that pmcp-pty hosts
from an operator-approved `[host]` are the one place where listed tool dialogs
may be answered for you (see
[Sessions pmcp-pty hosts](project-configuration.md#sessions-pmcp-pty-hosts)).

This feature requires PMCP 0.13.0 or later. PMCP 0.18.0 and later draw the
workspace with pmcp-tui (`crates/pmcp-tui`) on the group's pmcp-pty host
(`crates/pmcp-pty`); earlier releases used tmux views. The host needs Linux or
macOS, Node.js 22 or later, pmcp-pty and pmcp-tui. npm installs both with
PMCP on Linux and macOS (x64 and arm64) through a platform package
(`@modootoday/pmcp-<os>-<cpu>`); PMCP_PTY_BIN and PMCP_TUI_BIN override it, and
PATH is the fallback. The Linux binaries need glibc 2.35 or later. The macOS
binaries are unsigned; installed through npm they run as they are, since npm
sets no quarantine flag. Signing is decided when direct downloads start. On
Linux a working user systemd manager also caps
each native session in its own scope; macOS runs sessions uncapped. Windows is
not supported yet.

## Open a workspace

From a supported interactive terminal, run `pmcp` or `pmcp tui`. The first
launch lists installed runtimes, with a default in this order: Codex, Gemini,
agy, Grok, Claude. Enter accepts that default; a number selects another runtime.
Confirm with Enter at the start prompt, or enter q to cancel. No provider request
or group creation occurs before this confirmation. Use `--runtime` to skip the
picker and choose a supported runtime ID explicitly.
Provider login and folder trust still use the native screen.

```sh
pmcp
pmcp tui --runtime codex-cli
pmcp tui plan
```

The start creates a private owned group with its own pmcp-pty host and opens
pmcp-tui on it, read-only, with main shown first. Later launches reconnect to
that workspace. Defaults are 2048 MiB for the group, 768 MiB for its main and at
most two active sessions. Taking control remains explicit with Ctrl-g then c.
This launches a native process; the defaults are cooperative host supervision,
not a Docker isolation policy. Use an explicitly configured Docker group when
you require that execution profile.

Start a worker in the saved project workspace without preparing a session JSON
file:

```sh
pmcp tui start-worker --runtime gemini-cli
```

It uses the configured session memory by default; `--memory-mb` overrides that
reservation. The existing group retains its allowed runtimes, execution profile
and budgets. An unavailable main, paused group or stale generation blocks the
start. The new worker appears in the dock. Native login, folder trust and tool
approvals remain in the worker's own screen.

The nearest `pmcp.toml` within the Git repository determines the project root,
including from nested cwd. A submodule does not inherit its parent's config;
use `--config` when you explicitly want a different configuration scope.
Without a config, the current real directory is the project root. Customize only
the values you need:

```toml
[tui]
runtime = "codex-cli"
memory_mb = 2048
session_memory_mb = 768
max_active = 2
```

runtime defaults to auto. Supported IDs are codex-cli, gemini-cli, antigravity,
grok-cli and claude-code. CLI `--runtime` overrides the config for a new main.
An optional group_file points to a deliberately selected existing owned group
with a live main; relative paths resolve from the config directory. `--config`
selects a config file explicitly. Unknown keys and invalid budgets are errors.
Config budget changes apply to a new group; existing groups keep their grants.

`pmcp tui launch --yes` explicitly confirms the first start without the prompt.
Launch still requires a supported interactive terminal. `pmcp tui plan` reports
resolved settings and saved paths without writing or invoking a provider.
The launcher checkpoint lives under XDG_STATE_HOME/pmcp/launcher, or
~/.local/state/pmcp/launcher, with private file permissions.

Reopening never adopts an unrelated session or restarts a stopped main. A
paused group, interrupted start or changed generation requires explicit harness
inspection and recovery. After explicitly stopping the old owned group,
`pmcp tui --new` creates a new workspace. Detach preserves the existing native
process and draft. Keep original state when investigating a failed start. If a
creation checkpoint has no group path yet, keep it for manual inspection; the
launcher refuses to infer ownership or restart from that incomplete state.

Workspaces created by releases that used tmux are not migrated. Close them with
the release that created them, then start a new one here. The tmux view
operations (`pmcp tui create`, `open`, `close` and the others taking `--view`)
are removed: they end with a usage error (exit 2) that names the change.

Piped bare launches and leading MCP server options preserve the existing stdio
contract. Use `pmcp serve` explicitly in MCP configuration. Unsupported
interactive hosts show help; they do not wait for JSON-RPC input.

`pmcp tui doctor` checks the host: platform, Node, pmcp-pty, pmcp-tui and on
Linux the systemd tools and user manager. It lists native executables found on
PATH; an installed executable is not proof of authentication or successful
native behavior.

## Layout

At 120 columns by 32 rows or larger, main fills the left, workers appear on the
right, and coordination occupies four bottom rows. Smaller terminals keep a
full-width main; Ctrl-g then g shows the dock and coordination instead. The
minimum is 40 by 12. A shown session keeps its own size, so watching never
reflows a session someone else is driving; a session you control is resized to
the main pane.

## Observe and control

Press Ctrl-g, release it, then press a key:

| Key      | Action                                           |
| -------- | ------------------------------------------------ |
| m        | Return to main, giving control back first        |
| w or 1–9 | Observe a worker                                 |
| c        | Take control of the shown session                |
| r        | Give control back                                |
| h        | Read the shown session's history                 |
| b        | Show inbox metadata (when an observer is set up) |
| g        | Show or hide the management screen (compact)     |
| d        | Leave the workspace, every session still running |
| !        | Dismiss the last visible error                   |
| ?        | Show the keys                                    |

Press Ctrl-g twice to send Ctrl-g to the native interface.

The status line names MAIN or WORKER, the session and OBSERVE / INPUT OFF.
Control goes through REQUESTING CONTROL and CONNECTING WRITER to CONTROL READY,
the only state with INPUT ON. Taking control holds the session's lease in
pmcp-pty, which then refuses any other writer and any program input (such as an
automatic wake) without it. Control is not taken while the runtime is mid-turn.
Leaving the session, or Ctrl-g r, gives the lease back first. A failed release
shows CONTROL UNKNOWN and keeps input off until Ctrl-g r succeeds. Even without
control, a person typing in an attachment wins over program input for five
seconds after the last keystroke.

Failures stay in the status line and coordination panel until dismissed. PMCP
never replays uncertain input. An input receipt or mailbox ACK does not
establish model completion. Provider state remains unknown.

## History and mailbox

History shows the shown session's own output, bounded to 2000 lines and 64 KiB,
scrolled with the arrow and page keys; Esc or q returns. It does not include
shell history from before the runtime.

The mailbox panel shows message, thread and reply IDs through the existing
mailbox CLI for an explicitly chosen observer actor. Run pmcp-tui with
`--mailbox-config ./pmcp.toml --actor-file "$OBSERVER_ACTOR_FILE"` to enable it.
It never reads bodies, marks messages read, acknowledges them, submits input or
wakes a runtime. Use the [mailbox CLI](mailbox.md) for those explicit actions.

## Detach and recovery

Detach preserves processes and drafts. Reopening returns to read-only main
observation. Leaving while in control gives the lease back; a crash leaves it to
lapse within 30 seconds. Inspect before retrying, without replaying input:

```sh
pmcp harness recovery inspect --group-file "$GROUP_FILE"
pmcp harness attach inspect --group-file "$GROUP_FILE" --session "$SESSION"
```

For a workspace opened through bare pmcp, inspect the saved launcher without
starting a runtime:

```sh
pmcp tui recovery
```

This reads the checkpoint and validates its saved group ownership and
generation. It reports exact inspection commands and, where applicable,
explicit resume, stop or fresh-launch commands. It does not execute them or
certify that a process is still alive. An explicitly selected configuration
is preserved in the proposed fresh-launch command:

```sh
pmcp tui recovery --config /path/to/pmcp.toml
```

If creation stopped before a group reference was saved, the result is
manual-inspection. Preserve the reported checkpoint and examine owned launch
evidence before changing it. Matching project paths alone cannot establish
ownership. Paused work stays paused, and uncertain input is never replayed.

Stopping a session is a harness operation (`pmcp harness session stop`); there
is no stop key. These controls are CLI-only and cannot be invoked through the
MCP server.
