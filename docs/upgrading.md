# Upgrading

[Back to the overview](../README.md)

What to do when a release changes something you rely on. Each release's notes on GitHub
Releases list its breaking changes and link here.

## From 0.24 to 0.25

**`pmcp status` exits 4 only for projection drift or a budget overrun.** A linked worktree
ahead of or behind the mainline no longer sets `drift` or the exit code; it is counted in
the summary line and in the new `data.lagging` field. A script that relied on exit 4 to
notice worktree lag reads `lagging` from `pmcp status --json` instead.

**Operator verbs run only as the operator.** `pmcp sessions pause` and `resume`,
`pmcp heavy --now` (and `PMCP_HEAVY_NOW`), `pmcp heavy promote --now`,
`pmcp heavy cancel --force` on another session's job and `pmcp git deliver --during-pause`
now exit 1 inside an agent session, with a line telling the agent to ask you. From your own
terminal nothing changes. A script or cron job that runs one of them has no terminal: give
it an operator token,

```toml
[sessions.operator]
via = "token"
token_file = "~/.config/pmcp/operator-token"   # outside the project, chmod 600
```

and run it with `PMCP_OPERATOR_TOKEN` set to the file's contents. A gate or hook that ran
`pmcp heavy --now` for its own stages should use the `gate` or `hook` profile, or a reason
in `[host.lease] skip_always`, instead.

**`--by` no longer defaults to `operator`.** `pmcp sessions broadcast`, `send` and `reply`
sign with the agent session they run in, or with `operator` only from the operator's
terminal; `--by operator` anywhere else exits 2. A command run inside a runtime whose
session pmcp cannot find (Gemini CLI, OpenCode) now exits 2 asking for `--session <id>` or
`--by <name>` instead of acting as the operator.

**The `pmcp.operator_verbs` guard is on with any session feature.** A project that declares
`[sessions.registry]`, `[sessions.pause]` or another session table gets it in deny mode;
run `pmcp project` once so the hook policy carries it (`pmcp project --check` reports the
drift until then). Turn it off with
`[hooks.guards.pmcp.operator_verbs]` `mode = "off"`.

**Lease skip reasons are a closed set.** `PMCP_HEAVY_DISABLE=<reason>` (and the
`legacy_skip_env` variable) is honoured only for `nested` (set by pmcp inside a leased job,
and honoured only there), `operator` (only for the operator) and the names you list:

```toml
[host.lease]
skip_reasons = ["ci", "subagent-no-lease"]   # ordinary commands
skip_always = ["git-hook", "gate-light"]     # also bulk jobs; allowed as reasons too
```

Any other reason runs nothing and `pmcp heavy` exits 2 with the allowed list. A wrapper
that read the old nested value `inside pmcp heavy <pid>` now sees `nested`; the old
value is still read as `nested` until 0.26. Reasons are lower-case words, so a
`skip_always` entry with spaces or capitals is now a configuration error.

**A declared `[host.lease]` turns the `host.lease` guard on in observe.** Without a
`heavy` list, the table now gets pmcp's `"default"` preset (install, test, build and
typecheck for npm, pnpm, yarn, bun and cargo), so the guard logs what it would refuse.
Run `pmcp project` to project it; set `heavy = []` to keep the guard off. A finding an
`observe` or `warn` guard let through is now logged at info: after a week,
`pmcp hooks report --switch-check host.lease` shows what `guard = "deny"` would refuse.

## From 0.23 to 0.24

**A lease skip no longer covers a bulk job.** `PMCP_HEAVY_DISABLE=<reason>` (or the
`legacy_skip_env` variable) still runs an ordinary command at once, but a job in the bulk
lane, sent with `--lane bulk` or put there by a `[host.lease] commands` entry, now queues
for the lease with a line saying the skip was not honoured. A wrapper that skipped the lease
for installs or whole test suites will see them wait. For a caller that must never wait (a
commit hook), list its reason in `[host.lease] skip_always`:

```toml
[host.lease]
skip_always = ["git-hook"]
```

A bulk job nested in a leased job still runs at once on the lease marker. `--now --reason`
remains the emergency path, and `enabled = false` still turns the lease off. A skipped run's
usage record now carries `skip`, and `pmcp heavy stats` shows the share of runs that skipped
the lease.

**For contributors: tests run in their own temp and state roots.** `npm test` gives the run
its own `TMPDIR` and XDG directories and fails when a test leaves a `pmcp-*` directory in the
real temp directory or a project in the real pmcp state directory; see
[CONTRIBUTING.md](https://github.com/modootoday/pmcp/blob/main/CONTRIBUTING.md).

## From 0.22 to 0.23

0.23.0 makes the command line behave like other command-line tools; several changes break
scripts that relied on the old behaviour.

**Results go to standard output.** The human result of a command (the `list`, `models`,
`marketplace list` and `doctor` tables, `validate` findings, the `status` summary, `hooks`
and `sessions` listings, an `install` or `sync` plan, and help you asked for with `--help`)
now goes to standard output; before, it went to standard error. Progress, summaries,
warnings and errors stay on standard error. `-q` silences only standard error (errors still
print), so `pmcp -q list` prints the table. A script that captured a table with `2>&1` or
`2>file` should read standard output instead; one that discarded standard output to keep a
terminal quiet should redirect it too. Off a terminal a table is now one unpadded record per line
(`name  description`), and on a terminal it wraps to the width.

**A leading option `serve` does not accept no longer starts the server.** `pmcp -v`,
`pmcp -V` and `pmcp version` print the version, like `--version`. Any other leading option,
such as `-x` or `--verison`, exits 2. A host that starts the server with leading options
(`pmcp --root ./node_modules`) is unaffected; one that passed an option `serve` rejects was
already failing. A short flag a command does not declare (`pmcp list -j`) exits 2 instead of
being ignored; use `--` before a positional that starts with a dash. A word after
`pmcp list` or `pmcp models`, which take none, exits 2 instead of being ignored.

**Drift has its own exit code, 4.** `pmcp status` with drift or an exceeded budget,
`pmcp project --check` with drifted, stale or undeclared outputs, `project --check --smoke`
and `hooks test --fixtures` with a finding now exit 4; before, the first three exited 2,
the same code as a mistyped flag, and `hooks test --fixtures` exited 1. Exit 2 now means
only that the command could not run as asked (bad arguments, no `pmcp.toml`). A failed
fetch in `pmcp git deliver` or `pmcp git sync` now exits 1, like the other failures, rather
than 2. A CI step that treated any non-zero code as failure needs no change; one that tested
for `2` to detect drift should test for `4`. See
[Exit codes](commands.md#exit-codes).

**`--json` prints one envelope.** Every `--json` output is now one line,
`{"schema":"pmcp.<command>[.<subcommand>].v1","ok":…,"data":…,"errors":[…]}`, and it is
printed on failure too (before, a failure printed nothing on standard output). What a
command printed before is `data`, unchanged, `version: 1` included: read `.data.policies`
where you read `.policies`, `.data` where `models --json` gave a bare array. `ok` mirrors
exit code 0, and `errors` carries the messages that went to standard error. `mcp status`
and the `tui plan`, `tui doctor`, `tui recovery` and `tui start-worker` receipts are human
text unless `--json` is given; before, they always printed JSON. `mailbox` and `harness`
keep their JSON receipts unchanged. See [JSON output](commands.md#json-output).

## From 0.22.12 to 0.22.13

**A gate command that exits 75 makes `pmcp git deliver` exit 75.** 75 now means a test stage
under `pmcp heavy` never got the host lease: deliver reports "gate not run: host busy,
nothing pushed, retry later" instead of a failed gate and exit 1. A gate that used 75 for
another failure should exit with another code.

**Words after `--` belong to the command.** `-q`, `--quiet`, `--color`, `--no-color` and
`--help` after a bare `--` are no longer read as pmcp's own options, so
`pmcp heavy -- grep -q x file` passes `-q` to grep.

## From 0.22.8 to 0.22.9

**Guards read commands with the shell's grammar.** A `cd` chain, a subshell, a pipeline stage
and a background job now decide which directory each step runs in, as the shell does, so a
push after `cd a && cd b` is judged in `a/b`, not in `b`. A command that is not shell syntax
is refused by every guard that fails closed; before, each guard matched it against a text
pattern of its own. See [Hooks](hooks.md).

## From 0.22.1 to 0.22.2

**Gate logs move to a directory per tip in the state directory.** A delivery's gate output was
`<dir of the gate tree>/logs/<time>-<tip>.log`, the newest 20 runs kept. It is now
`<state dir>/gate-logs/<tip>/<time>-<run>.log` (or under `[git.mainline.gate] log_dir`), every
run of a tip kept, with `<tip>/latest` naming the newest, and the newest `log_keep` (default 20) tips kept. The `--json` receipt's `gate` gains `logs`, the tip's directory. pmcp no longer
writes or prunes the old `logs/` directory; delete it when you no longer need it. A tool that
looked for logs there should use the receipt's `gate.log` or `<log_dir>/<tip>/latest`.

**A `pmcp.lock` a merge left unreadable no longer locks a session out.** The hook refuses
everything but the lock's repair, and names the conflict line and the commands that restore
it; see [Hooks](hooks.md).

## From 0.22.0 to 0.22.1

**Codex agent files are named with underscores.** Codex refuses a hyphen in the name it
spawns a sub-agent under, so an agent `frontend-implementer` is now
`.codex/agents/frontend_implementer.toml` with `name = "frontend_implementer"`. The next
`pmcp project` writes the new files and removes the hyphenated ones it wrote before. Anything
that names a Codex agent by its old hyphenated name, a prompt or a script, should use the
underscore name; `[agents.<name>.codex] name` sets another one.

**`[agents.<name>.codex]` reaches the Codex agent file.** 0.22.0 ignored it. Its keys are now
written into the file, so a hand-written Codex agent with settings such as `sandbox_mode` or
an `[mcp_servers.<id>]` table can move to `.agents/agents/<name>/agent.md` plus that table.
`developer_instructions` in the table is now an error: it is the agent's body. See
[Native files for each agent tool](project-configuration.md#native-files-for-each-agent-tool).

## From 0.21 to 0.22

**pmcp writes no `.grok/skills` links.** Grok Build reads `.agents/skills` itself (measured on
1.0.62, in a folder it trusts), so the links were duplicates. The next `pmcp project` removes the
ones it wrote. A Grok older than 1.0.62 was not measured; check that `grok inspect --json`
lists your project's skills after upgrading, and keep 0.21 for that project if it does not.

**`pmcp git sync` now works in a desk.** In 0.21 it exited 2 in any linked worktree. A
linked worktree matching `[git.worktrees] desks` (by default every worktree under
`[git.worktrees] root`) is now brought up to date with the mainline when that loses
nothing, and held with exit 1 otherwise; any other linked worktree still exits 2. A script
that relied on exit 2 to skip desks should check the kind first, or set `desks` to a
pattern that matches none. `[git.worktrees.sync] after_deliver = "desk"` syncs the
delivering desk after a delivery, and the `--json` receipt gains `desk_sync`. See
[Git workflow](git-workflow.md).

## From 0.20 to 0.21

**Session records are written to `sessions/` alone.** 0.20 also wrote each record to the
deprecated `fleet/` in the state directory; 0.21 stops. A tool that still reads `fleet/`
must read `sessions/<session>.json` instead. pmcp still reads `fleet/`, and of two copies
uses the one updated last, so a hook bundle from before 0.20 sharing the state directory
keeps being followed until `pmcp project` runs there again.

**`pmcp project --check` also fails on a broken hook entry pmcp does not own.** A command
in `.claude/settings*.json`, `.codex/hooks.json` or a tracked plugin's `hooks.json` that
names a missing script, or a script run directly that is not executable or has no `#!`
line, now makes `--check` exit 2 and `pmcp doctor` report a failure. Fix the entry, or the
script; [Hooks](hooks.md#native-hook-entries-pmcp-does-not-own) lists what is checked.

The rest is new, not removed:

- A commit that only moves submodule pins, each to a commit the mainline's pin already
  equals or contains, now counts as delivered. `pmcp git deliver` skips it, and
  `pmcp git sync` and worktree sync move past it instead of refusing.
- `[git.mainline.sync] after_deliver = "always"` also syncs the main checkout after a
  delivery run in a linked worktree; `"off"` turns the sync after a delivery off. The
  default `"from_main"` is 0.20's behaviour.
- With `gate = "pre-push"` the push output streams to the terminal as it comes; the gate
  log still keeps all of it.
- The `pmcp git deliver --json` receipt gains `sync`, the main checkout's sync after the
  delivery, and `replayed`, the tip of the last replay.
- `pmcp git deliver --no-push` replays and gates, then stops. See
  [Git workflow](git-workflow.md).
- `[[hooks.guards.custom]]` takes `mode` like a built-in guard (the default `deny` is
  0.20's behaviour), `on = "prompt"`, `"stop"` or `"session_start"`, and an installed
  program pinned by `version` instead of a script. Its request gains `protocol`
  (`pmcp.guard.v1`), `session` and, on `prompt`, `prompt`; its reply may add `findings`.
  A guard that reads only the earlier fields keeps working. See
  [Hooks](hooks.md#hooksguardscustom).
- `pmcp hooks report` summarises the guard log; `[hooks.report] exclude_sessions` leaves
  sessions out.
- `pmcp hooks test --fixtures <file>`, and `pmcp project --check --smoke` with
  `[hooks.test] fixtures`, run cases through the projected hooks.
- `[budget]` limits the root and package instruction files, the skills and the tracked
  paths; `pmcp project --check` enforces it and `pmcp status` shows it. See
  [Budget](project-configuration.md#budget).

## From 0.19 to 0.20

0.20 removes defaults that suited one kind of project rather than pmcp's users in general.
Each one stays available as configuration; add the lines below to `pmcp.toml` to keep what
0.19 did, then run `pmcp project`.

**The shared-checkout notice is opt-in.** 0.19 turned `[git.shared_checkout]` on in any git
checkout once the hook bundle existed. Declare it to keep the notice:

```toml
[git.shared_checkout]
```

**Dated `.bak` files are no longer secret paths by default.** 0.19 treated a file named like
`config.bak.20261027` as a credential. If yours hold credentials:

```toml
[hooks.guards.shell.secret_exfiltration]
extra_secret_paths = ['\.bak\.\d{8,}']
```

`.env.<name>` directories (`.env.d/`, `.env.local/`) are still caught as `.env` variants.

**`bun run git:land` and `bun run git:sync` are no longer lockfile operations by name.** The
shell classifier had them built in. A project's own landing or sync script is data:

- a package script run with `bun`, `npm`, `pnpm` or `yarn run` is matched by
  `[sessions.pause] script_names`, whose default `"^git:"` still covers `git:*` scripts;
- a script run with `node` is matched by `[sessions.pause] scripts`, for example
  `scripts = ['tools/release/(land|sync)\.mjs$']`.

**`catalog-v1` validates general catalog rules only.** `pmcp validate` with
`[catalog.validation] profile = "catalog-v1"` no longer reports `description.trigger`,
`keywords.ascii`, `output-license.required`, `server-tools.forbidden`,
`server-tools.required` or `server-tools.order`. `metadata.server-tools` is an optional list of
any tool names. A catalog that relies on those rules runs its own check beside
`pmcp validate`.

**Session records move from `fleet/` to `sessions/` in the state directory.** 0.20 writes
every record to both `sessions/<session>.json` and the deprecated `fleet/<session>.json`, and
reads both, using the copy updated last, so an older pmcp sharing the state directory (a hook
bundle not yet projected again) is followed. A tool that reads `fleet/` keeps working through
0.20; move it to `sessions/` and run `pmcp project` everywhere before 0.21, which stops
writing `fleet/`. A mail
recipient's linked worktree is now `worktree` throughout; `desk:<path>` is still accepted as a
spelling of `worktree:<path>`.

**Deliveries can leave gating to the repository's pre-push hook.** This is new, not a
removal. `[git.mainline.deliver] gate = "pre-push"` and `push_env` are described in
[Git workflow](git-workflow.md). A delivery's push now always carries `PMCP_GIT_DELIVER=1`, and
the `--json` receipt's `gate` gains `by`.

## From 0.17 to 0.18

0.18 replaces tmux with pmcp's own terminal host, so it does not read tmux groups or views.
Stop what 0.17 started before you upgrade, with the 0.17 release that created it:

```sh
npx @modootoday/pmcp@0.17.4 tui recovery          # a workspace from bare pmcp: prints groupFile and generation
npx @modootoday/pmcp@0.17.4 tui close --view "$VIEW_FILE"
npx @modootoday/pmcp@0.17.4 harness group inspect --group-file "$GROUP_FILE"   # any other group: prints the generation
npx @modootoday/pmcp@0.17.4 harness group stop --group-file "$GROUP_FILE" --generation "$GENERATION"
```

Then upgrade and start a new workspace with `pmcp tui --new` (plain `pmcp` once no 0.17
checkpoint is left). Scripts that called the removed `pmcp tui` view operations now get a
usage error (exit 2). The terminal workspace needs Linux or macOS; see
[Compatibility](compatibility.md).
