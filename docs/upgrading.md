# Upgrading

[Back to the overview](../README.md)

What to do when a release changes something you rely on. Each release's notes on GitHub
Releases list its breaking changes and link here.

## From 0.21 to 0.22

**pmcp writes no `.grok/skills` links.** Grok Build reads `.agents/skills` itself (measured on
1.0.62, in a folder it trusts), so the links were duplicates. The next `pmcp project` removes the
ones it wrote. A Grok older than 1.0.62 was not measured; check that `grok inspect --json`
lists your project's skills after upgrading, and keep 0.21 for that project if it does not.

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
