# Terminal workspace

Use `pmcp tui` to view an existing main runtime and its workers in one terminal.
The main conversation stays in its native interface. PMCP adds a worker dock,
coordination panel and explicit control switching. Provider login, folder trust
and tool approvals stay in their native screens.

This feature requires PMCP 0.13.0 or later. The host requires Linux, tmux,
util-linux flock, Node.js 22 or later and a working
user systemd manager. The PMCP CLI supports Node or Bun; pane helpers use Node.
The presentation gets its own 512 MiB, 128-task, one-CPU scope. Native sessions
retain their existing group budgets and execution profile.

## Open a workspace

The numbered runtime picker, worker menu and worker-start/recovery commands in
this guide target development source. npm 0.15.0 includes the original launcher;
these additions await the next release.

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

The start creates a private owned group and read-only view, then reconnects to
that workspace on later launches. Defaults are 2048 MiB for the group, 768 MiB
for its main and at most two active sessions. Terminal size selects the existing
A or compact layout. Taking control remains explicit with Ctrl-g then c.
This launches a native process; the defaults are cooperative host supervision,
not a Docker isolation policy. Use an explicitly configured Docker group when
you require that execution profile.

After opening a workspace, start a worker without preparing a session JSON file:

```sh
pmcp tui start-worker --runtime gemini-cli
```

This explicitly starts a worker in the saved project workspace. It uses the
configured session memory by default; `--memory-mb` overrides that reservation.
The existing group retains its allowed runtimes, execution profile and budgets.
An unavailable main, paused group or stale generation blocks the start. Native
login, folder trust and tool approvals remain in the worker's own screen.

In the view, Ctrl-g then n opens a worker picker. It releases input control
without submitting the main draft. Select a granted installed runtime and
confirm its start; q cancels without creating a worker. The new worker reserves
the same memory as the live main, within the existing group limits. Selection
does not switch the input target or acquire control. To use a different
reservation or an advanced view, run:

```sh
pmcp tui start-worker --view "$VIEW_FILE" --runtime gemini-cli --memory-mb 512
```

Use either --view or --config. A view start uses its owned group and generation;
it does not discover another project workspace. Docker runtime availability
follows that group's command policy rather than host native executables.
This worker menu is qualified on native groups; Docker execution remains subject
to its separately tested CLI and profile grants.

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

Reopening never adopts an unrelated tmux session or restarts a stopped main.
A paused group, interrupted start or changed generation requires explicit
harness inspection and recovery. After explicitly stopping the old owned group,
`pmcp tui --new` creates a new workspace. Detach preserves the existing native
process and draft. Closing only the view permits a new presentation over the
same live group. Keep original state when investigating a failed start.
If a creation checkpoint has no group path yet, keep it for manual inspection;
the launcher refuses to infer ownership or restart from that incomplete state.

Piped bare launches and leading MCP server options preserve the existing stdio
contract. Use `pmcp serve` explicitly in MCP configuration. Unsupported
interactive hosts show help; they do not wait for JSON-RPC input.

## Advanced view operations

First [create a harness group and its sessions](terminal-harness.md). Set GROUP_FILE
to that group's private state path, then check prerequisites and create a view:

```sh
pmcp --version
pmcp tui doctor
pmcp tui create --group-file "$GROUP_FILE" --columns 160 --rows 48
```

Set VIEW_FILE to viewFile from the JSON receipt:

```sh
pmcp tui inspect --view "$VIEW_FILE"
pmcp tui open --view "$VIEW_FILE"
```

Only open requires an interactive terminal. Create can take its dimensions from
the current terminal; give both dimensions explicitly when calling from a script.
At 120 columns by 32 rows or larger, main fills the left, workers appear on the
right, and coordination occupies four bottom rows. Smaller terminals keep a
full-width main and a separate management window. The minimum is 40 by 12.
Views refer to an existing owned group and do not start a provider.

Doctor checks host prerequisites, including access to the systemd user manager,
and lists native executables found on PATH. An installed executable is not proof
of authentication or successful native behavior. The report leaves native
acceptance unassessed and does not read authentication profiles.

| Finding                   | Next step                                                                                                                       |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Missing tmux or flock     | Install tmux or util-linux for your Linux distribution and check PATH in this terminal.                                         |
| Unsupported Node          | Select Node.js 22 or later through your existing version manager, then check node --version.                                    |
| Unreachable user manager  | Run systemctl --user status in the same login session; restore manager access before launching. Doctor does not start services. |
| Missing native runtime    | Install the vendor's CLI and select its runtime ID explicitly. Installation alone does not establish login or folder trust.     |
| Unsupported terminal host | Use a qualified Linux host for this workspace. Other PMCP features keep their own prerequisites.                                |

Doctor does not invoke a native runtime, inspect private authentication files,
test a model reply or prove cgroup delegation. Native acceptance and isolated
execution require separate measurements against the exact installed version.

### Measured terminal behavior

Linux acceptance on 2026-10-10 covered the following native main/worker pairs.
Each run checked read-only observation, explicit worker input with an actual
reply, main draft preservation, resize and detach/reconnect. These bounded
checks do not certify every vendor feature or another authentication profile.

| Native runtime | Tested version            | Main and worker terminal checks |
| -------------- | ------------------------- | ------------------------------- |
| Codex          | 0.161.0                   | Passed                          |
| Gemini CLI     | 0.63.0                    | Passed                          |
| Grok CLI       | 1.0.50                    | Passed                          |
| agy            | 1.3.3                     | Passed                          |
| Claude Code    | Not measured in this wave | Deferred                        |

Separate synthetic PTY checks cover multiline Korean paste, read-only mouse
input, owned history and nested tmux. They do not establish each vendor's
own editing or mouse behavior. Use Ctrl-g then h to read owned history without
sending input. Claude acceptance, other operating systems and physical host
loss remain outside these results. Docker installation and native credential
isolation have separate qualification; this terminal run does not replace them.

## Observe and control

Press Ctrl-g, release it, then press a key:

| Key      | Action                                       | CLI operation           |
| -------- | -------------------------------------------- | ----------------------- |
| m        | Return to main and release worker control    | main                    |
| w or 1–4 | Observe a worker                             | observe --index 1       |
| n        | Choose and confirm a new worker              | worker-menu             |
| c        | Request control of the current native target | control                 |
| r        | Release control                              | release                 |
| h        | Read owned native history                    | history                 |
| b        | Show configured inbox metadata               | mailbox                 |
| g        | Open compact management window               | management              |
| d        | Detach the view, preserving runtimes         | detach                  |
| !        | Dismiss the last visible error               | dismiss                 |
| ?        | Show key help                                | Help in the status line |

CLI operations use pmcp tui OPERATION --view "$VIEW_FILE". Worker indices follow
the dock; CLI observe supports all available indices. Press Ctrl-g twice to
forward Ctrl-g to the native interface. Native Ctrl-b remains available when
you hold control. A surrounding tmux may consume its own prefix first.

The status line identifies MAIN or WORKER, its session and OBSERVE / INPUT OFF.
Control progresses through REQUESTING CONTROL and
CONNECTING WRITER to CONTROL READY. A lease alone does not enable typing: PMCP
checks that the writable native client is attached to the selected pane's TTY.
Only CONTROL READY shows INPUT ON.
Input stays blocked during acquisition and release. A control lease identifies
the writer, not which native prompt or approval menu is active.

Another writer causes a visible error with a next step. Failures remain in the
status line, coordination panel and inspect receipt until explicitly dismissed.
Resize does not clear them. CONTROL UNKNOWN blocks input and requires inspection.
PMCP never replays uncertain input. An input receipt or mailbox ACK does not
establish model completion. Provider state remains unknown.

## History and mailbox

History reads only the owned runtime pane, bounded to 2000 lines and 64 KiB.
It does not include shell history from before the runtime. The history panel
supports tmux copy mode; returning to main preserves its native draft. Closing
the view removes its private history cache.

To observe inbox metadata, supply an explicitly chosen mailbox observer actor:

```sh
pmcp tui create --group-file "$GROUP_FILE" --columns 160 --rows 48 --config ./pmcp.toml --actor-file "$OBSERVER_ACTOR_FILE"
```

The actor must have no live attachment. PMCP uses the existing mailbox service
and refuses a conflicting attachment. The panel shows message, thread and reply
IDs. It never reads bodies, marks messages read, acknowledges them, submits input
or wakes a runtime. Use the [mailbox CLI](mailbox.md) for those explicit actions.
The view stores the private credential file reference, not its contents.

## Detach, close and stop

Detach preserves processes and drafts. Reopening returns to read-only main
observation after releasing this view's control. A lost outer terminal also
requests release; a crash or unreachable manager may prevent confirmation.
Inspect before retrying, without replaying input:

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

Close ends the presentation and preserves all native runtimes:

```sh
pmcp tui close --view "$VIEW_FILE"
```

Stop names the exact current native target and requires confirmation:

```sh
pmcp tui stop --view "$VIEW_FILE" --confirm-session "$SESSION"
```

There is no stop keyboard shortcut. Group replacement invalidates a view's
generation: create a fresh view instead of transferring old authority. These
controls are CLI-only and cannot be invoked through the MCP server.
