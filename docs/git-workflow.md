# Git workflow

[Back to the overview](../README.md)

Linked worktrees, one delivery path to the mainline and main checkout sync, configured by
`[git]`. [Run several agents](sessions.md) shows how it fits with sessions; the other tables
are in the [pmcp.toml reference](project-configuration.md).

| `[git]` key | Type                  | Default                                    | Meaning                                                                                                |
| ----------- | --------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `enabled`   | `"auto"`, true, false | `"auto"`                                   | `auto` turns the git features on when the project is a git checkout; `false` turns all of them off.    |
| `remote`    | string                | `origin` if present, else the first remote |                                                                                                        |
| `mainline`  | string or table       | the remote's HEAD branch, else `main`      | A string names the branch; a table (`[git.mainline]` with `branch`) also holds gate, deliver and sync. |

`[git.shared_checkout]` warns a session working in the main checkout of a
repository that also has linked worktrees, tracks the files it edits there,
and names leftovers not yet delivered, because they block syncing the shared main for
everyone. Keys: `enabled` (`"auto"` default, following `[git] enabled`, or a
boolean), `warn_on_session`, `track_edits`, `warn_claimants` (booleans, default
`true`). It is on in any git checkout without a table, once something else
enables the hook bundle.

`[git.worktrees]` configures the linked worktrees `pmcp git worktree` creates:

| Key              | Type      | Default                    |
| ---------------- | --------- | -------------------------- |
| `root`           | string    | `".claude/worktrees"`      |
| `branch_prefix`  | string    | `"worktree-"`              |
| `alias_pattern`  | regex     | `"^[a-z][a-z0-9-]{1,30}$"` |
| `bootstrap`      | argv list | none                       |
| `link_from_main` | list      | `[]`                       |

`[git.worktrees.sync]` (opt-in) keeps each linked worktree on the mainline when moving it
loses nothing: `on_session_start` (`"fetch_and_move"` default, `"move"`,
`"off"`), `between_prompts` (`"move_if_light"` default, `"off"`: move only when
no install is needed), `install_after_move` (`"off"` default, `"background"`,
`"foreground"`) and `notice_paths` (paths whose change is announced to the
session). Installs never block a session.

`[git.mainline.gate]`: `command` (argv; no gate when missing), `tree` (the
gate's worktree, default `<state dir>/gate/tree`; a relative path is relative to
the main checkout, like `state_dir`), `lock_wait_seconds`
(default `5400`), `lock_env` (an environment variable name), `tree_env` (an
environment variable name) and `log_dir` (default `<dir of tree>/logs`). Each
gate's full output goes to `<log_dir>/<UTC time>-<tip>.log` as well as the
terminal; pmcp names the file when the gate starts and again if it fails, and
keeps the newest 20. With `max_load` (the 1-minute load average, e.g. `6`) a
delivery that holds the lock waits until the load is below it before the gate starts,
checking every 15 seconds for up to `load_wait_seconds` (default `1800`), and then
fails without running the gate; once started, a gate is never retried.

One delivery gates at a time: pmcp takes an exclusive `flock` on the file `lock`
beside the gate tree (`<dir of tree>/lock`), so another tool that takes the same
file with `flock` (a workspace land script) and pmcp never gate together. With
`lock_env` set, pmcp sets that variable to `1` for the gate command and its
children, and a `pmcp git deliver` started with it already `1` runs under its
caller's lock instead of waiting for it. `tree_env` names a variable that, when
set, gives the gate tree instead of `tree`, and so moves the lock and every
`${gate_dir}/` path with it (a temporary gate for tests or a bootstrap).
While a delivery holds the lock it keeps `holder.json` beside it,
`{tip, subject, checkout, pid, startedAt}`, so a tool waiting on the same lock
can say whose gate it waits for; the file is removed on release.

A lease is `<state dir>/<name>-lease.json` unless `[sessions.leases.<name>] file`
places it elsewhere, for another tool that coordinates the same lockfile; both
read and write `{pid, subject, cwd, since}`, and a record whose process is gone
counts as free. With `events` set, each delivery that changed the leased paths
appends one line there: `{at, subject, commit, hash, installed, lease}`, where
`commit` is the delivered upstream, `hash` the leased files' hash in the main
checkout after sync, and `installed` whether sync's install ran for that hash.

`[git.mainline.deliver]` enables `pmcp git deliver`, which replays commits onto
the fetched mainline, runs the gate, and pushes one delivery at a time:
`attempts` (default `3`), `refuse_direct_push` (default `true`: a hook refuses
`git push` from any checkout of this repository, so the mainline moves only
through delivery), `during_pause` (`"refuse"` default or `"allow"`),
`lease_wait_seconds` (default `3600`) and `notify` (argv run after a
delivery).

`pmcp git deliver --json` prints one receipt on stdout when it ends, progress
staying on stderr: `{ok, code, delivered, upstream, attempts, gate, leases,
reason?}`, where `delivered` is the upstream commit it pushed (or `null`), `gate`
is `{exit, log}` for the last gate run (or `null`), `leases` the leases it took
and `reason` the last refusal or failure. Exit codes: `0` delivered or nothing
to deliver; `1` refused, a lease or the gate lock held too long, a replay
conflict, the gate failed, the push failed or it gave up after `attempts`; `2`
fetch failed or no configuration.

`[git.mainline.sync]` enables `pmcp git sync`, which moves the main checkout to
the mainline: `install` (argv), `install_when_changed` (paths; when no
`[sessions.leases]` are declared, these become an implicit `lockfile` lease),
`keep_identical_files` and `refuse_with_unlanded` (booleans, default `true`).

`[git.submodules]`: `follow = "clean_pins"` (the default when the table is
present) moves submodules to the pinned commit when they are clean; `"off"`
leaves them. Without the table submodules are not followed.
