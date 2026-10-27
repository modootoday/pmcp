# Git workflow

[Back to the overview](../README.md)

Linked worktrees, one delivery path to the mainline and main checkout sync, configured by
`[git]`. [Run several agents](sessions.md) shows how it fits with sessions; the other tables
are in the [pmcp.toml reference](project-configuration.md).

| `[git]` key | Type                  | Default                                    | Meaning                                                                                                                                                                                                                                                                                                                   |
| ----------- | --------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `enabled`   | `"auto"`, true, false | `"auto"`                                   | `auto` turns the git features on when the project is a git checkout; `false` turns all of them off.                                                                                                                                                                                                                       |
| `remote`    | string                | `origin` if present, else the first remote |                                                                                                                                                                                                                                                                                                                           |
| `mainline`  | string or table       | the remote's HEAD branch, else `main`      | A string names the branch; a table (`[git.mainline]` with `branch`) also holds gate, deliver and sync.                                                                                                                                                                                                                    |
| `umask`     | octal string          | none (the process's)                       | e.g. `"022"`. `pmcp git` commands and the session-start worktree move write checkouts under it: sync, worktree sync and create, deliver (its gate tree included) and the installs they run. Tracked files they rewrote also get their index mode back (0644, or 0755 for executables); untracked files are never touched. |

`[git.shared_checkout]` warns a session working in the main checkout of a
repository that also has linked worktrees, tracks the files it edits there,
and names leftovers not yet delivered, because they block syncing the shared main for
everyone. Keys: `enabled` (`"auto"` default, following `[git] enabled`, or a
boolean), `warn_on_session`, `track_edits`, `warn_claimants` (booleans, default
`true`). Like every feature it is opt-in: declare the table, even empty, to
turn it on.

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
session). Installs never block a session. A worktree is not moved while the
workspace is paused or while any lease is held (every `[sessions.leases.<name>]`,
or the implicit `lockfile` lease), and the session is told which.

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
file with `flock` (a project's own landing script, say) and pmcp never gate together. With
`lock_env` set, pmcp sets that variable to `1` for the gate command and its
children, and a `pmcp git deliver` started with it already `1` runs under its
caller's lock instead of waiting for it. `tree_env` names a variable that, when
set, gives the gate tree instead of `tree`, and so moves the lock and every
`${gate_dir}/` path with it (a temporary gate for tests or a bootstrap).
While a delivery holds the lock it keeps `holder.json` beside it,
`{tip, subject, checkout, pid, startedAt}`, so a tool waiting on the same lock
can say whose gate it waits for; the file is removed on release.

A lease is `<state dir>/<name>-lease.json` unless `[sessions.leases.<name>] file`
places it elsewhere, where any tool coordinating the same paths can read and
write it; a record whose process is gone counts as free. With `events` set, each delivery that changed the leased paths
appends one line there: `{at, subject, commit, hash, installed, lease}`, where
`commit` is the delivered upstream, `hash` the leased files' hash in the main
checkout after sync, and `installed` whether sync's install ran for that hash.
The fields of every shared file are listed under
[Shared file formats](#shared-file-formats).

`[git.mainline.deliver]` enables `pmcp git deliver`, which replays commits onto
the fetched mainline, runs the gate, and pushes one delivery at a time:
`attempts` (default `3`), `refuse_direct_push` (default `true`: a hook refuses
`git push` from any checkout of this repository, so the mainline moves only
through delivery), `during_pause` (`"refuse"` default or `"allow"`),
`lease_wait_seconds` (default `3600`), `notify` (argv run after a
delivery), `gate` and `push_env`.

A commit is already on the mainline when `git cherry` finds the same patch there,
or when it only moves submodule pins, each to a commit that the mainline's pin for
that path equals or contains. Containment is read in the submodule's checkout,
else in the repository git keeps for it, and without either the commit counts as
missing. Delivery skips such a commit; `pmcp git sync` and worktree sync move past
it as a landed duplicate, so another session's newer pin never makes a replay
conflict or a sync refusal.

The push of a delivery runs the repository's own hooks, so a pre-push hook that
gates as well needs one of two set-ups.

- `gate = "pre-push"` makes that hook the gate: pmcp takes the lock, replays and
  retries, runs no `[git.mainline.gate] command` (declaring one is an error),
  and pushes with `lock_env` set to `1`, so a hook that takes the same lock does
  not wait on pmcp. The push output streams to the terminal as it comes and is
  kept as the gate log, and a refused push is a failed gate.
- `gate = "command"` (the default) keeps pmcp's command as the gate.
  `push_env` (a table of variable names to strings, default `{}`) adds variables
  to the push alone in either mode, so a hook can recognise a delivery that was
  already gated and step aside.

Every delivery push also carries `PMCP_GIT_DELIVER=1`. In command mode the lock
variable reaches the push only if `push_env` names it.

`pmcp git deliver --json` prints one receipt on stdout when it ends, progress
staying on stderr: `{ok, code, delivered, upstream, attempts, gate, leases,
sync, reason?}`, where `delivered` is the upstream commit it pushed (or `null`),
`gate` is `{exit, log, by}` for the last gate run (or `null`; `by` is
`"command"` or `"pre-push"`), `leases` the leases it took, `sync` is
`{from, to, code, reason?}` for the main checkout's sync after the delivery (or
`null` when none ran: its HEAD before and after, the exit code of
`pmcp git sync`, and its last warning) and `reason` the last refusal or failure.
Exit codes: `0` delivered or nothing to deliver, even when the sync after it was
refused; `1` refused, a lease or the gate lock held too long, a replay
conflict, the gate failed, the push failed or it gave up after `attempts`; `2`
fetch failed or no configuration.

`[git.mainline.sync]` enables `pmcp git sync`, which moves the main checkout to
the mainline: `install` (argv), `install_when_changed` (paths; when no
`[sessions.leases]` are declared, these become an implicit `lockfile` lease),
`keep_identical_files` and `refuse_with_unlanded` (booleans, default `true`) and
`after_deliver`. With the table present, a delivery syncs the main checkout once it is
delivered, holding its leases through the install: `after_deliver = "from_main"`
(the default) does so only for a delivery run in the main checkout, `"always"`
also for one run in a linked worktree, and `"off"` never. Every refusal of
`pmcp git sync` still applies, and a refused sync leaves the delivery a success.

After a successful install, sync records the hash it installed in a stamp and
installs again only when that hash changes. By default the stamp is pmcp's own,
in its state directory. `stamp` puts it at a path another tool also reads
(`${git_dir}/name` is in the checkout's own git directory, so each worktree has
one; `~/` and absolute paths work too). `stamp_hash = "plain"` makes the hash the
sha256 of the single `install_when_changed` file's bytes, which other tools can
compute and write themselves; the default `"pmcp"` hashes every listed path with
its name. Delivery events record the same hash and whether the stamp matches it.

`[git.submodules]`: `follow = "clean_pins"` (the default when the table is
present) moves submodules to the pinned commit when they are clean; `"off"`
leaves them. Without the table submodules are not followed.
`shared` lists submodules other sessions also edit in the main checkout (an
app kept in its own repository, for example): those move to the new pin even with uncommitted edits, as
long as no edited or untracked file is one the pin changes. When one is, the
submodule stays on the old pin and sync names the files; pmcp never restores,
stashes or discards them.

With `push = "pins"`, `pmcp git deliver` first makes sure every submodule commit the
delivered commits pin is on that submodule's origin. A pin already on a remote branch
needs nothing. Otherwise exactly the pinned commit is pushed to the submodule's
branch (`branch` in `.gitmodules`, else `main`) as a fast-forward, never a later
commit; if that branch has moved past the pin's base, delivery stops before
anything else moves.

## Shared file formats

Delivery and sync coordinate through plain files, so any tool, a project's own
scripts included, can wait on, read or write the same state. These are pmcp's
formats: within a release line fields are only added, never renamed, retyped or
removed, and readers ignore fields they do not know. Times are UTC ISO 8601
strings, and JSON files are written whole through a rename.

| File                | Where                                                    | Content                                                                                                                                                                                                                                                                                     |
| ------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lock`              | beside the gate tree                                     | Empty; held with `flock -x` for the whole of one delivery's gate.                                                                                                                                                                                                                           |
| `holder.json`       | beside `lock`                                            | `{tip, subject, checkout, pid, startedAt}`: the commit being gated (full hash), its subject, the checkout delivering it, the holding process and when it took the lock. Removed by its writer before the lock is released, and only when `pid` is its own.                                  |
| `<name>-lease.json` | the state directory, or `[sessions.leases.<name>] file`  | `{pid, subject, since, cwd?}`. A lease whose `pid` is not alive is free; whoever takes it next replaces the file.                                                                                                                                                                           |
| lease events        | `[sessions.leases.<name>] events`                        | JSON Lines, one per delivery that changed the leased paths: `{at, subject, commit, hash, installed, lease}`, with `commit` the delivered upstream (10 characters), `hash` the leased files' hash in the main checkout after sync, and `installed` whether sync's install ran for that hash. |
| install stamp       | `[git.mainline.sync] stamp`, else pmcp's state directory | One line: the hash last installed. With `stamp_hash = "plain"` it is the sha256 hex of the single `install_when_changed` file's bytes; with `"pmcp"`, a hash of every listed path and its name.                                                                                             |
