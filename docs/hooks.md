# Hooks

[Back to the overview](../README.md)

`[hooks]` in `pmcp.toml` compiles guards, checks and session bookkeeping into one hook bundle that
every targeted runtime runs on its tool calls. The other tables are in the
[pmcp.toml reference](project-configuration.md).

`pmcp project` compiles `[hooks]`, `[sessions]`, `[git]` and `[logging]` into
`.agents/pmcp-hooks/policy.json`, copies the hook beside it as `hook.mjs` (a
small loader) and `hook-body.mjs`, and registers `hook.mjs` in
`.claude/settings.json` and `.codex/hooks.json` for the events the declared
features use. Gemini, Antigravity, Grok and OpenCode are opt-in: name them in
`[hooks] targets` and pmcp registers the same hook in their files (see
[Runtime support](#runtime-support)). `pmcp.lock` pins the hash of `policy.json`; the hook refuses to
act on a policy that does not match it, so every policy change is a reviewed
projection. Codex shows changed entries under `/hooks` as needing review;
untrusted hooks do not run. Each Codex, Claude and Grok entry carries a
`statusMessage` such as `pmcp session start` or `pmcp before tool`: Codex
lists hooks under that name, and Claude and Grok show it while the hook runs.
Gemini entries keep their `name` (`pmcp-<event>`), which is part of the
identity Gemini trusts.

The hook keeps two per-user caches under `$XDG_CACHE_HOME/pmcp` (default
`~/.cache/pmcp`), never in the project: Node's compile cache for the body
(`hook-compile/`) and the last integrity verdict per `policy.json`
(`hook-verified.json`). A verdict is reused only while neither `policy.json`
nor `pmcp.lock` has been written since. Either cache can be missing or
unwritable without changing a decision; `PMCP_HOOK_COMPILE_CACHE=off` turns the
compile cache off.

Every feature is opt-in: a table that is missing turns its feature off, and a
declared table, even an empty one, turns it on. The exceptions are documented
where they apply: `[git]` features detect git (`enabled = "auto"`),
`[git.shared_checkout]` is on in any git checkout once the bundle exists, and
logging falls back to its defaults rather than to no logging. The bundle is
projected only when `[hooks]` declares guards or checks, a `[sessions.*]`
feature table is declared, `[git.shared_checkout]` or `[git.worktrees.sync]` is
declared, or `[git.mainline.deliver]` keeps `refuse_direct_push`.

## `[hooks]`

| Key                  | Type         | Default                                        | Meaning                                                                                                                                                                 |
| -------------------- | ------------ | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `targets`            | list         | `[targets] tools` limited to `claude`, `codex` | Runtimes that receive the hook bundle: `claude`, `codex`, `gemini`, `antigravity`, `grok`, `opencode`. The last four are used only when listed here.                    |
| `ask_fallback`       | string       | `"deny"`                                       | What an ask becomes on a runtime without ask (Codex, Gemini, Antigravity, Grok, OpenCode): `deny`, `warn`, or `refuse` to make projection fail while any guard may ask. |
| `error_log`          | bool or path | `true`                                         | `true` writes JSONL logs under the state directory's `logs/`; a project-relative path writes one file there instead; `false` turns hook logging off.                    |
| `emergency_off_file` | path         | none                                           | While this file exists every guard passes. `~`, `$HOME/` and absolute paths are allowed; other paths are relative to the project.                                       |

## `[hooks.guards.<group>.<name>]`

Each built-in guard is one table. `mode` is the only key the option-less
guards take; an unknown option is an error. Modes: `deny` and `ask` replace
the guard's verdict with that mode, `warn` turns the reason into context the
agent reads, `off` drops the guard, and `graded` keeps the guard's own split
between ask and deny. `observe` runs the guard and logs what it found but gives the runtime
nothing, no verdict and no context, even when the guard fails; use it to run a guard
beside a hook it will replace and compare. Every guard writes one debug log line per
call: `policy`, `session`, `verdict` (what the call got) and, under `data`, `raw`
(what the guard found: `allow`, `ask` or `deny`), `mode`, `tool` (the tool kind) and
`native` (the runtime's tool name), never the command, the reason or the prompt.

| Table                                      | Default mode | Modes                                 | Refuses                                                                                                              |
| ------------------------------------------ | ------------ | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `[hooks.guards.shell.in_place_edit]`       | deny         | deny, ask, warn, observe, off         | `sed -i`, `perl -i`, `awk -i inplace`: edits without a diff.                                                         |
| `[hooks.guards.shell.heredoc]`             | deny         | deny, ask, warn, observe, off         | Heredocs and here-strings, whose body the shell expands silently.                                                    |
| `[hooks.guards.shell.stdin_interpreter]`   | ask          | deny, ask, warn, observe, off         | An interpreter reading its program from stdin (`python3 -`, `cat x.py \| python3`).                                  |
| `[hooks.guards.shell.compose_teardown]`    | deny         | deny, ask, warn, observe, off         | `docker compose down`, and `stop`, `rm` or `kill` with no service named: they hit every service.                     |
| `[hooks.guards.shell.secret_exfiltration]` | graded       | deny, ask, warn, observe, off, graded | Reading a credential asks; sending one over the network, or changing a live one, denies.                             |
| `[hooks.guards.shell.host_approval]`       | deny         | deny, ask, warn, observe, off         | `host approve`, and commands or edits touching the host approvals directory. On by itself when `[host]` is declared. |
| `[hooks.guards.git.push_without_verify]`   | deny         | deny, ask, warn, observe, off         | `git push --no-verify`.                                                                                              |
| `[hooks.guards.git.forced_branch_move]`    | deny         | deny, ask, warn, observe, off         | Forcing a branch that is checked out in another working tree.                                                        |
| `[hooks.guards.git.gate_bypass_env]`       | deny         | deny, ask, warn, observe, off         | Setting a named gate-bypass variable where it takes effect, and optionally `--no-verify` on any git command.         |
| `[hooks.guards.git.stage_all]`             | deny         | deny, ask, warn, observe, off         | `git add -A`, `git add .`, `git commit -a` and similar; stage explicit paths.                                        |

Options:

- `[hooks.guards.shell.secret_exfiltration]`: `extra_secret_paths` (list of
  case-insensitive regular expressions, default `[]`), and
  `[[hooks.guards.shell.secret_exfiltration.value_commands]]` entries for a
  CLI that prints or publishes secret values: `binary` (required), `read`
  (verbs that print a value, so reading asks) and `publish` (verbs that change
  a live value, so they deny). Built in are `.env` files, `.dev.vars`, private
  keys, `.npmrc`, `.netrc`, `auth.json` and service-account files; a file whose
  name merely contains "secret" or "credential" is not one, so list such files
  in `extra_secret_paths`. Only a file a command reads counts: a search
  pattern, a sed or awk script, a jq filter or `-e` code that mentions `.env`
  does not.
- `[hooks.guards.git.gate_bypass_env]`: `names` (variable names, default `[]`)
  and `no_verify` (boolean, default `true`).

A mention is not a match: commands are parsed into steps, so
`git commit -m "never git push --no-verify"` and `echo 'cat <<EOF'` pass. A
command the parser cannot read is judged by a conservative pattern instead.

## `[[hooks.guards.custom]]`

A project script under `.agents/guards/` that decides like a built-in guard.

| Key          | Type      | Default          | Meaning                                                                                                                                                                                              |
| ------------ | --------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`       | string    | required         | `^[a-z0-9][a-z0-9-]*$`, unique across custom, shell and edit entries.                                                                                                                                |
| `command`    | argv list | required         | The first or second element is the script, which must exist inside `.agents/guards/`; its sha256 is pinned in `policy.json`.                                                                         |
| `targets`    | list      | required         | Any `[hooks] targets` runtime. A runtime in `[hooks] targets` runs it in the hook bundle; otherwise Codex, Gemini and Antigravity use the shell adapter, and Claude, Grok and OpenCode are an error. |
| `timeout_ms` | integer   | `15000`          | 100 to 60000.                                                                                                                                                                                        |
| `on`         | string    | `"before_shell"` | `before_shell` or `after_edit`.                                                                                                                                                                      |

The script receives the JSON contract described under
[Deprecated shell guards](#deprecated-shell-guards). Custom guards have no `mode`.

## `[hooks.failure]`

What a guard that fails to evaluate means for the call: it threw, or it ran past
`timeout_ms`. A guard's own deny is a verdict and is never affected. Without the
table a failed guard refuses the call (a bookkeeping guard such as the session
registry lets it through), as it always has.

| Key          | Type    | Default | Meaning                                                                                                                                                                                                                                                           |
| ------------ | ------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `timeout_ms` | integer | `2000`  | Longest one try of a guard may take (100 to 60000). The projected runtime timeout covers every try.                                                                                                                                                               |
| `retry`      | integer | `1`     | Further tries before the failure counts (0 to 3).                                                                                                                                                                                                                 |
| `pass`       | list    | `[]`    | What still goes through after the last try, with a warning: `read` (read tools) and `edit-own-worktree` (edits whose every path is inside the session's linked worktree, never the shared main checkout). Everything else, every shell call included, is refused. |

```toml
[hooks.failure]
timeout_ms = 2000
retry = 1
pass = ["read", "edit-own-worktree"]
```

The same applies when the hook as a whole fails (it cannot load its policy, read the
session store or evaluate): the call is judged by its tool kind alone. A policy that
no longer matches pmcp.lock is still refused, table or not. The runtime timeout pmcp
projects covers every try plus the hook's startup, so the runtime never stops the hook
before the table decides.

Either way the call carries one line naming the guard and the cause, e.g.
`pmcp hooks: sessions.leases failed (timeout 2000 ms); refused`.

## `[hooks.checks.after_edit]` and `[hooks.checks.on_stop]`

Checks report through context and never block; a check that cannot run is
logged and stays quiet.

| Table                       | Key                | Type      | Default     | Meaning                                                                                                           |
| --------------------------- | ------------------ | --------- | ----------- | ----------------------------------------------------------------------------------------------------------------- |
| `[hooks.checks.after_edit]` | `validator_glob`   | glob      | required    | Validator scripts inside the project; after an edit, only the validators whose directory owns an edited path run. |
|                             | `command`          | argv list | required    | Must contain `{validator}`, replaced by the validator's path. Runs directly, never through a shell.               |
|                             | `debounce_seconds` | number    | `60`        | One run per validator per window.                                                                                 |
|                             | `report`           | string    | `"context"` | The only value.                                                                                                   |
| `[hooks.checks.on_stop]`    | `project_check`    | boolean   | `true`      | After a turn that edited files, run `pmcp project --check` and report drift.                                      |
|                             | `report`           | string    | `"context"` | The only value.                                                                                                   |

The stop check runs the checkout's own pmcp (`node_modules`), else the CLI that
last projected this checkout on this machine (recorded in the state directory
as `projector.json`), and only at the version `pmcp.lock` records. A pmcp on
`PATH` is never used. When none matches, the session hears
`projecting pmcp not available` once instead of a drift report.

## Runtime support

From the measured capability files in `docs/hooks/capabilities/` (Claude Code
2.1.303, Codex 0.163.0, including live sessions). `pmcp doctor` prints the same
table for your project, with Codex trust.

| Feature                                                                                        | Claude Code                | Codex                                    |
| ---------------------------------------------------------------------------------------------- | -------------------------- | ---------------------------------------- |
| sessions registry, pause, leases, broadcast                                                    | measured                   | measured                                 |
| `[sessions.roles.<name>]`                                                                      | works; not live-measured   | unsupported: Codex sends no `agent_type` |
| `[git.shared_checkout]`, `[git.worktrees.sync]`, `[git.mainline.deliver]`                      | measured                   | measured                                 |
| heredoc, compose_teardown, push_without_verify, forced_branch_move, gate_bypass_env, stage_all | measured                   | measured                                 |
| in_place_edit, stdin_interpreter, secret_exfiltration (ask)                                    | ask not measured           | ask lowered by `ask_fallback`            |
| host_approval                                                                                  | works; not live-measured   | works; not live-measured                 |
| `[hooks.checks.after_edit]`                                                                    | measured                   | measured                                 |
| `[hooks.checks.on_stop]`                                                                       | measured, in the same turn | at the next prompt                       |
| `[[hooks.guards.custom]]`                                                                      | not measured               | not measured                             |
| `[ui.claude]`                                                                                  | Claude only                | not applicable                           |

Codex limits that shape the projection:

- Codex has no ask. An ask becomes `ask_fallback` (`deny` by default).
- Codex sends no `agent_type`, so roles cannot apply there.
- Codex rejects context on Stop, so Stop notices are delivered at the next
  prompt.
- Codex clamps a SessionEnd hook to 3 s; pmcp projects at most 3 s for it.
- Codex has no Notification event.
- Codex's own command filter rejects a fully quoted executable before any hook
  runs; use the ordinary unquoted form.

Gemini CLI 0.63.0, Antigravity (`agy`) 1.4.2, Grok 1.0.62 and OpenCode 1.18.33
are opt-in `[hooks] targets`. The pmcp bundle ran live on each in the same
thirteen scenarios as Claude Code and Codex, judged from each runtime's own
transcript; the `live` block of each capability file names the runs. A context
a runtime does not deliver at an event is held and delivered at the next event
that does, and that was measured live too. On OpenCode, prompt context goes
into the system prompt, which OpenCode does not store, so its delivery is shown
by a probe rather than by the prompt scenario. agy runs prompt policies on
every turn: its counter resets per turn.

| Feature                                     | Gemini                       | Antigravity                   | Grok                         | OpenCode                     |
| ------------------------------------------- | ---------------------------- | ----------------------------- | ---------------------------- | ---------------------------- |
| refusing a tool call (guards, pause, git)   | measured deny                | measured deny                 | measured deny                | measured (thrown error)      |
| context (broadcast, warnings)               | start, prompt, after tool    | first model call, Stop        | tool events, Stop            | start, prompt, after tool    |
| `[sessions.registry]`                       | every event                  | tool events, first call, Stop | every event                  | every event                  |
| `[sessions.roles.<name>]`                   | unsupported: no `agent_type` | unsupported: no `agent_type`  | unsupported: no `agent_type` | unsupported: no `agent_type` |
| ask (in_place_edit, stdin_interpreter, ...) | lowered by `ask_fallback`    | lowered by `ask_fallback`     | lowered by `ask_fallback`    | lowered by `ask_fallback`    |
| `[hooks.checks.on_stop]`                    | at the next delivering event | Stop continues once           | in the same turn             | at the next prompt           |
| `[[hooks.guards.custom]]`                   | not measured                 | not measured                  | not measured                 | not measured                 |

Where each runtime's projection goes, and what it needs:

- Gemini: `.gemini/settings.json` `hooks`, timeouts in milliseconds. Gemini
  ignores project settings in a folder the user has not trusted, and records
  each new hook in `~/.gemini/trusted_hooks.json`; `pmcp doctor` reads both
  and reports them, and never writes them. Trusting the folder is the user's
  step in an interactive `gemini` session.
- Antigravity: one named set `pmcp` in `.agents/hooks.json`, beside the shell
  adapter's `pmcp-shell`. agy denies a tool call whose hook names no decision,
  so pmcp always writes one. agy has no session or prompt event: the first
  model call of a conversation is the session start, the first of a later
  turn the prompt. Whether that counter resets for a later prompt in an
  interactive session is not measured. No trust step.
- Grok: grok also runs `.claude/settings.json` hooks, so with `claude` in
  `[hooks] targets` pmcp writes only the Claude file and the hook recognises a
  grok call by its payload; with Grok alone it writes `.grok/hooks/pmcp.json`.
  Never both, or every check would run twice. Project hooks run only after
  the user runs `/hooks-trust`; `pmcp doctor` reads
  `~/.grok/trusted_folders.toml` without writing it.
- OpenCode: there are no shell hooks, so pmcp writes `.opencode/plugins/pmcp.js`,
  a small plugin pinned in `pmcp.lock` that passes each call to the hook. A
  refusal is thrown as an error; Stop (`session.idle`) only updates the
  registry. No trust step.

`auth = "pmcp"` MCP servers project through `pmcp project exec-mcp` for every
runtime above.

## Deprecated shell guards

Deprecated: `[[hooks.shell]]` and `[[hooks.edit]]` still work, and `pmcp project`
warns. Declare `[[hooks.guards.custom]]` instead, with `on = "before_shell"` or
`on = "after_edit"`, and list its runtimes in `[hooks] targets`: every runtime
now has a hook bundle adapter, and this separate shell adapter will be removed
in a later major release.

Declare a project-owned guard explicitly to project it into Codex, Gemini or
Antigravity's native hooks. Without a declaration, pmcp generates no hooks.

```toml
[[hooks.shell]]
name = "shell-command-policy"
command = ["node", ".agents/guards/shell-command-policy.mjs"]
targets = ["codex", "gemini", "antigravity"]
timeout_ms = 15000
```

The guard script must exist under .agents/guards/ and cannot resolve outside
that directory. It receives one JSON object on stdin containing runtime,
event=before_shell, command and cwd. It returns a JSON object with
decision=allow or decision=deny and an optional reason. Malformed responses,
nonzero exits and timeouts deny the shell call. The guard receives PATH and
LANG rather than the native CLI's credential environment. Non-shell tools are
outside this contract.

Run pmcp project to write lock-owned adapter and policy artifacts under
.agents/pmcp-hooks/, plus the native entries in .codex/hooks.json,
.gemini/settings.json and .agents/hooks.json. Peer entries are retained.
Edited owned hook entries refuse projection for review. Removing a declaration
removes its generated entries and artifacts while preserving peer settings.
Writes retain private backups; pmcp project --check only reports drift.

Guard, policy and adapter fingerprints bind the generated command. Changing
guard code requires reprojection and native Codex hook review. Generated files
contain no trust bypass. Grok can load Claude project hooks, so this first scope
does not generate a second Grok guard. Hooks do not force pmcp catalog use,
inject reminders or replace the runtime's execution sandbox.

## Deprecated edit guards

Codex edit guards run after apply_patch through native PostToolUse hooks:

```toml
[[hooks.edit]]
name = "edit-policy"
command = ["node", ".agents/guards/edit-policy.mjs"]
targets = ["codex"]
timeout_ms = 15000
```

The guard receives runtime=codex, event=after_edit, the patch in command and cwd.
It returns the same allow/deny response as a shell guard. A denial becomes
native blocking feedback with the reason; the completed file edit remains on disk
for correction. Other tools do not invoke this guard. Edit targets currently
support Codex only, and names must be unique across shell and edit declarations.

Run pmcp project after declaring or changing the guard, then review and trust
the generated native definition in /hooks. Peer entries and shell guards are
preserved. Fingerprints and failure handling follow the shell-guard contract.
See the [native hooks documentation](https://learn.chatgpt.com/docs/hooks).
