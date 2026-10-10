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

## Observe and control

Press Ctrl-g, release it, then press a key:

| Key      | Action                                       | CLI operation           |
| -------- | -------------------------------------------- | ----------------------- |
| m        | Return to main and release worker control    | main                    |
| w or 1–4 | Observe a worker                             | observe --index 1       |
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

The default is read only. Control progresses through REQUESTING CONTROL and
CONNECTING WRITER to CONTROL READY. A lease alone does not enable typing: PMCP
checks that the writable native client is attached to the selected pane's TTY.
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
