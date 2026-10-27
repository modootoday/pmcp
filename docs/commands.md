# Command reference

[Back to the overview](../README.md)

Every pmcp command with its flags, behaviour and exit codes. `pmcp <command> --help` prints
the same usage from the command itself.

## The invocation a host uses

- `pmcp` opens a workspace on a supported terminal; a piped launch runs the MCP server on
  stdio.
- `pmcp --root ./node_modules`: a leading option with no command is still a server, because
  hosts pass options without one.

An unrecognised command does not fall through to a server the caller did not ask for. Only an empty argument list, or one that begins with an option, takes that path.

## status

```sh
pmcp status [--config <file>] [--json]
```

Show enabled features and their TOML or auto source, projection drift, live sessions, pause, leases, unseen broadcasts, worktree ahead/behind counts, shared MCP credential presence, logged errors from the last hour, and, with a [`[budget]`](project-configuration.md#budget) table, each limit beside what it measured. Reads do not acknowledge broadcasts, refresh credentials, prune logs, fetch or move git refs. Projection uses the same check as `project --check`. Exit 0, or 2 when projection or worktree ahead/behind drift exists or a budget limit is exceeded. Missing or invalid input follows the normal usage/failure exit contract. Human output is a compact summary on stderr; JSON retains the full details.

## init

```sh
pmcp init [--preset solo|multi-session] [--force]
```

Create `pmcp.toml` in the current directory. Solo enables Claude/Codex targets, the stage-all and heredoc guards, and detected git settings. Multi-session adds registry, pause and broadcast; in git it also enables worktree commands and shared-checkout warnings. Git remote and mainline come from the same detection used by the git workflow. No gate, installation command, MCP credential or provider is invented. Both presets are parsed and compiled before writing. Existing files require `--force`. Output explains each choice; projection remains a separate explicit operation. Exit 0 on creation, 2 for a bad preset or refused overwrite, 1 for a write failure.

## hooks

```sh
pmcp hooks list [--runtime claude|codex] [--config <file>] [--json]
pmcp hooks test --runtime claude|codex --event before_tool --command "git add -A" [--json]
pmcp hooks test --runtime claude --event before_tool --path fixture.txt --session-state state.json
```

List compiled policies per runtime and neutral event, including mode and source table. Test constructs a synthetic payload in that runtime's recorded shape, normalizes it, runs policy selection and composition, lowers unsupported asks, and renders the native response. The event accepts a neutral name or a supported native name. Choose at most one of `--command`, `--path` and `--tool`; these selectors require a tool event. Tool accepts a native name or shell, edit, read or other, subject to that runtime's tool vocabulary. No native runtime or model call is needed.

Session state is isolated in a temporary directory, then removed. Commands and patches are classified, never executed. External custom guards, validators, Stop projection subprocesses and worktree synchronization are explicitly marked skipped. Their simulated context reports this limitation; the command does not claim a full live result. Exit 0 means the simulation completed, even when the rendered decision denies; invalid input exits 2. Per-policy timings and reasons precede the rendered output in human mode.

`--session-state` accepts a JSON object with optional `records` (session records with valid 8–64 character IDs), `pause` (by, reason, since), `leases` (name to pid, subject, since, optional cwd), and `broadcast` (id, by, text, since). Pause and broadcast may be null. Existing liveness and unseen-broadcast rules apply. This file and the real session store remain unchanged.

```sh
pmcp hooks report [--since 2d] [--json]
pmcp hooks report --switch-check shell.heredoc [--since 2d] [--json]
```

`report` summarises the guard lines the hook bundle writes to the project log at debug level (`[logging] level = "debug"`, or `PMCP_LOG=debug`). For each guard and runtime it counts the runs, what the guard found before its mode (`raw`: allow, deny, ask) and what the call got, the modes seen, the sessions, and the p50, p95 and longest durations. Sessions matching a `[hooks.report] exclude_sessions` regex (replays, smoke runs) are left out and counted. `--since` takes a duration such as `10m`, `2h` or `3d`, or an ISO time. `--switch-check <guard>` lists instead the calls that guard found something in and let through, because it was in `observe` or `warn`: what `deny` would have refused. The log holds no command, prompt or transcript text, so neither does the report. `--json` prints `{version, since?, lines, sessions, excluded, guards}`, or `{version, guard, refused}` with `--switch-check`.

## Read command JSON schemas

These opt-in snapshots write one JSON object and a newline to stdout, with `version: 1`. No color or human summary is mixed into stdout. Errors remain on stderr. Without the flag, existing human output is retained, including MCP status's original unversioned object and logs' JSONL stream. Schemas are named in [schemas.json](https://pmcp.build/commands/schemas.json); each entry under `schemas` uses the shared root `$defs`. Consumers must allow unknown fields inside session, decision and log records. Tokens are never part of an auth status object.

| Command                    | Schema            | Fields after version                                                  |
| -------------------------- | ----------------- | --------------------------------------------------------------------- |
| `status --json`            | status            | config, drift, features, projection, sessions, worktrees, mcp, errors |
| `hooks list --json`        | hooks-list        | policies: runtime, event, policy, mode, source                        |
| `hooks test --json`        | hooks-test        | runtime, event, payload, decision, policies, rendered                 |
| `sessions status --json`   | sessions-status   | live, pause, leases, broadcasts with unseenBy session IDs             |
| `logs --json`              | logs              | records; filtered snapshot, incompatible with --follow and --pretty   |
| `git worktree list --json` | git-worktree-list | worktrees: path, main, optional alias, branch, behind and ahead       |
| `mcp status <name> --json` | mcp-status        | name, present, expiresAt (UTC string or null), scopes                 |

Feature rows have feature, enabled and source. Projection has drift, outputs and problems. Session snapshots include only live records; broadcasts include the IDs that have not yet seen each entry. Worktree counts are omitted when the upstream cannot be compared; absence does not assert equality. Status auth rows add a redacted error when credentials are unavailable or invalid. Errors are JSONL records with valid timestamps within the last hour, excluding future rows. Hooks test observations have policy, mode, decision, durationMs, skipped, source, verdict and reason; rendered has stdout and exitCode. The final decision includes runtime lowering, while each policy row retains its configured verdict. Mutating sessions, git and MCP verbs reject `--json`.

## serve

```sh
pmcp serve [--config <file>] [--root <dir>] [--scope <prefix>] [embedding options]
```

Reachable by name so it appears in help. It writes nothing to standard output: from the moment it starts, standard output is the protocol, and a diagnostic printed there corrupts the stream.

## list

```sh
pmcp list [--root <dir>] [--scope <prefix>] [--json]
```

The skills discovered in `node_modules`, as two aligned columns, or as JSON for a script. This is the command that answers "would the server see anything from here".

## marketplace

```sh
pmcp marketplace list --json
pmcp marketplace export typescript-5 --runtime agy --output ./typescript-plugin
agy plugin install ./typescript-plugin
```

List the bundled free plugins or export one selected native package. Choose `claude`, `codex`, `gemini`, `grok` or `agy`. An export preserves existing destinations and does not edit runtime configuration or bypass native installation consent. CLI discovery includes the built-in catalog unless `--no-builtin` or `[catalog] builtin = false` is configured.

An empty catalog is a finding rather than a success. It exits **1** and names the roots it walked, because a project that installed this and sees nothing has a misconfiguration worth an exit code.

## index

```sh
pmcp index [--config <file>] [embedding options] [--local-only] [--dry-run] [--force] [--json]
```

Encodes each description once so ranking can be semantic, and stores the vectors beside the tree they describe, so two projects never share one index. Only what changed is re-encoded; an unchanged description produces the same vector at the same cost as the first time.

Vectors written by one model are never scored against another, so `--model` is part of the key rather than a preference. Without the optional peer installed it exits **3** and tells you ranking stays lexical, which is the default and not a failure.

A partial index is reported rather than called success: it exits **1** and says how many of the catalog it covered, because ranking needs a vector for every entry and falls back to lexical without one.

## models

```sh
pmcp models [--json]
```

Lists the default E5 encoder and optional EmbeddingGemma presets with their dimensions and asset revisions. It does not load an encoder or download weights. Configure `[embedding]` in `pmcp.toml` or override individual settings on the CLI.

```sh
pmcp index --model embeddinggemma-2 --dtype q4 --dimensions 256
pmcp serve --model embeddinggemma-2 --dtype q4 --dimensions 256
```

Shared embedding options are `--model`, `--dtype`, `--dimensions`, `--model-revision`, `--model-path`, `--model-cache`, `--query-prefix`, `--passage-prefix`, and `--pooling`. They override the corresponding configuration fields. Use `--no-config` for an independent CLI selection. Model identity includes revision, dtype, dimensions, prefixes, pooling, and projection, so incompatible vectors and query caches stay separate.

`index --local-only` refuses downloads, `--dry-run` previews work without loading a model or writing vectors, and `--force` rebuilds only the selected encoder's index. `serve` never downloads weights: it uses a complete matching local index or reports a lexical fallback. Restart after switching encoder settings.

## mailbox

```sh
pmcp mailbox init --config ./pmcp.toml
pmcp mailbox actor --config ./pmcp.toml --actor reviewer --actor-file /private/reviewer.actor.json
pmcp serve --config ./pmcp.toml --mailbox-actor-file /private/reviewer.actor.json --mailbox-runtime codex-cli
```

Mailbox is disabled by default. Initialization creates a project UUID and preserves existing configuration. A launcher-bound actor enables `mailbox_send`, `mailbox_inbox`, `mailbox_read`, `mailbox_ack`, and `mailbox_sessions`. Reading records a receipt; acknowledgement requires reading first. Acknowledgement does not assert task completion.

Credentials and attachment files contain secrets and must stay outside source control. State defaults to the user's XDG state directory. Administrative `rotate`, `export`, `backup`, and `restore` operations require `--operator`. Use `pmcp mailbox --help` for inputs. The mailbox exchanges peer data; the host owns authentication, automatic runtime delivery, and enterprise policy.

## project

```sh
pmcp project
pmcp project --check [--smoke]
pmcp project import-mcp --source codex:/path/to/config.toml
```

Generate selected runtimes' native files from `pmcp.toml`. Unmanaged entries and credential references are preserved; conflicts stop the write. `--check` reports drift without writes, and MCP import previews changes by default; `--write` applies them. `--check --smoke` then runs the `[hooks.test] fixtures` file as `pmcp hooks test --fixtures` does, and exits 2 on any finding. [Configuration and guard examples](project-configuration.md).

Configuration files and the ownership lock are replaced atomically one file at a time. If projection is interrupted, inspect with `pmcp project --check`, then run `pmcp project` explicitly to repair drift. Projection does not start a runtime or replay terminal input. The complete set of files is not a single transaction.

## sessions

```sh
pmcp sessions status
pmcp sessions pause "release freeze" [--by <name>]
pmcp sessions resume
pmcp sessions broadcast "main moved; rebase before delivering" [--by <name>]
pmcp sessions unbroadcast
pmcp sessions sweep
pmcp sessions send --to <selector>... [--subject <s>] [--wake] <body>
pmcp sessions inbox
```

Coordinate the live agent sessions of this repository and its worktrees, through the state the hooks keep for [`[sessions]`](project-configuration.md#sessions). `status` (the default verb) prints each live session, the pause, current broadcasts, held leases and undelivered edits in a shared checkout to standard output, or `no live sessions`. `pause` refuses edits and mutating commands in every other session until `resume`; `broadcast` delivers its text once to each session as context, and `unbroadcast` withdraws it. `--by` names the sender, whose own session is exempt; it defaults to `operator`. `sweep` removes records whose process is gone. `send` addresses `all`, `session:<id>`, `alias:<name>`, `role:<name>` or `worktree:<path>` through `[sessions.mailbox]`; `inbox` lists your messages. [Run several agents](sessions.md) walks through them. Exit 0, or 2 for an unknown verb, missing text or no `pmcp.toml`.

## logs

```sh
pmcp logs --since 10m --level warn --pretty
pmcp logs --session 4f92 --component hooks
pmcp logs --trace 7cef825e8fbd8c3f
pmcp logs --follow
```

Read this project's JSONL logs from the state directory, or the file `[hooks] error_log` names. Filters combine: `--session` takes an id prefix, `--trace` one hook call, `--component` a component and those below it, `--level` that level and more severe, `--since` a duration (`10m`, `2h`, `3d`) or an ISO time. Records print as JSON lines unless `--pretty`; `--follow` keeps printing until interrupted. Secret values, prompt text and environment values are redacted at write time, per [`[logging]`](project-configuration.md#logging). Exit 0, or 2 for an unusable filter or no `pmcp.toml`.

## git

```sh
pmcp git worktree create review [--base <ref>]
pmcp git worktree list
pmcp git worktree sync
pmcp git deliver [<commit>...] [--during-pause] [--no-push] [--json]
pmcp git sync
```

The git workflow configured by [`[git]`](git-workflow.md). Each subcommand needs its table; without it the command exits 1 and names the missing table.

- `worktree create <alias>` makes a linked worktree under `[git.worktrees] root` on a new branch from the upstream (or `--base`), links the configured files from the main checkout, runs `bootstrap`, and prints the path.
- `worktree list` prints alias, branch, behind/ahead and path for the main checkout and each linked worktree.
- `worktree sync` moves the current worktree onto the mainline when that loses nothing; exit 1 when it is held back.
- `deliver` fetches, replays the named commits (default: the ones the upstream lacks) onto the mainline, runs the gate in its own tree under a lock, and pushes; it replays again if the mainline moved. A delivery that touches a leased path holds that lease until it has pushed and installed, and it refuses during a pause unless `--during-pause` or `during_pause = "allow"`. `--no-push` replays and runs the gate command, then stops: it takes no lease and pushes, syncs and notifies nothing, and it refuses `gate = "pre-push"`, where the push is the gate. Exit 0 delivered, gated with `--no-push`, or nothing to deliver; 1 refused, gate failed or attempts exhausted; 2 fetch failed or `--no-push` with the pre-push gate.
- `sync` moves the main checkout to the mainline, installs when a listed file changed, and follows clean submodule pins. Exit 0 moved or already equal, 1 when local work would be lost, 2 when blocked (undelivered edits) or the fetch failed.

## completion

```sh
pmcp completion bash > ~/.local/share/bash-completion/completions/pmcp
pmcp completion zsh > "${fpath[1]}/_pmcp"
pmcp completion fish > ~/.config/fish/completions/pmcp.fish
```

Print a completion script for commands and global options to standard output. Exit 0, or 2 for another shell.

## mcp

```sh
pmcp mcp login remote [--no-wait | --code <callback-or-code>] [--port <port>] [--client-id <id>] [--bearer-env <name>]
pmcp mcp status remote
pmcp mcp logout remote
```

Manage a shared remote MCP session for a server declared with `auth = "pmcp"`. Login prints an authorization URL and accepts a loopback callback or pasted code. Status reports presence, UTC expiry and scopes; tokens are never printed. Bearer credentials can be loaded with `--bearer-env`. Native authentication remains the default. [Shared authentication configuration](project-configuration.md#shared-remote-mcp-authentication).

## doctor

```sh
pmcp doctor
pmcp doctor --memory
```

Inspect native configuration and prerequisites, including [native hook entries pmcp does not own](hooks.md#native-hook-entries-pmcp-does-not-own), which `project --check` also checks. The optional memory report shows enabled state and paths; it does not read memory contents or synchronize personal memory. [Doctor scope and runtime compatibility](project-configuration.md).

## validate

```sh
pmcp validate
```

Validate discovered skill documents and their contracts without starting a native runtime. [Skills reference](skills.md).

## harness

```sh
pmcp harness doctor inspect
pmcp harness group inspect --group-file "$GROUP_FILE"
pmcp harness recovery inspect --group-file "$GROUP_FILE"
pmcp harness host approve | status | up | down | unit
pmcp harness mcp
```

Optional local supervision of owned native main and worker sessions on pmcp-pty. Groups run on Linux (glibc 2.35 or later, with a working user systemd manager) or macOS, with Node.js 22. Start, input, stop and recovery actions are explicit CLI operations. Provider OAuth, trust and approvals remain native; MCP tools cannot invoke this execution path. [Group creation, control and recovery](terminal-harness.md).

`harness host` runs the long-running sessions listed in `[host]` of `pmcp.toml`: `approve` records your approval of the projected policy, `status` reports it, `up` starts pmcp-pty and the approved sessions, `down` stops them and `unit` prints a systemd user unit. `up` and `unit` need Linux. `harness mcp` is a stdio MCP server for one pmcp-pty socket (`PMCP_PTY_SOCKET`); its write tools exist only when the approved policy sets `mcp_write`. [The [host] table](project-configuration.md#sessions-pmcp-pty-hosts).

## tui

```sh
pmcp
pmcp tui plan
pmcp tui --runtime codex-cli
pmcp tui doctor
```

Open a native main terminal, worker dock and coordination panel with defaults or an optional `[tui]` table in `pmcp.toml`. The first launch confirms the selected runtime; later launches reconnect to this project's owned workspace. The workspace starts read only; taking control and stopping a runtime require explicit actions. Opening requires an interactive terminal and the same host as the harness. [Keys, mailbox observation and cleanup](terminal-workspace.md).

## The written skills

Local discovery, configuration and terminal supervision need no PMCP account. Configuration and supervision can change local state; native runtimes retain their own provider login requirements. [Package-specific skills](https://pmcp.build/skills/) are free to read, download and install without PMCP login. Each skill page links the original SKILL.md and a content-only archive that your package manager can install directly. The service commands below also support hosted catalogs with their own access policies.

All four take `--project <dir>`, `--api <origin>`, `--json`, and `--catalog <file>`, which reads a saved response so the command runs with no network at all.

## available

```sh
pmcp available [--project <dir>] [--catalog <file>] [--json]
```

Which written skills match the dependencies this project already has. It reads your `package.json` to decide what matches and does not upload it. No account needed.

## preview

```sh
pmcp preview <skill-package> [--json]
```

A skill's contents and one complete example. The sample is taken from the skill's own bytes rather than described, so it cannot drift from what you would receive. No account needed.

## login · logout · whoami

```sh
pmcp login [--issuer <url>]
pmcp logout
pmcp whoami [--json]
```

`login` signs this machine in without a browser: it prints a code and a URL to open anywhere. The credential is kept outside the project, so it cannot be committed or copied into an image. `whoami` answers on stdout, so a script can read it. This optional service login is not needed to use the free package skills on pmcp.build.

[skills.modoo.today](https://skills.modoo.today) is a separate skill catalog service built on pmcp, with its own accounts and access policies; `pmcp login` and `--provider hosted` reach it. pmcp itself needs no account there.

## install · sync

```sh
pmcp install <skill-package>... | --all [--dry-run | --yes]
pmcp sync [--project <dir>] [--dry-run | --yes]
```

`install` adds skill packages as dev dependencies with your own package manager, and what gets installed is checked against the digest the catalogue published — not its name and version, which any registry can claim. `sync` updates the ones already declared and removes nothing else. pmcp uses the free bundled public catalog by default and verifies immutable archives and installed resources without login. Explicit `--provider hosted` or `--api` selects a separate service's credentialed distribution, such as skills.modoo.today (see [login](#login--logout--whoami)).

Both show the project and lockfile changes and stop: `--yes` approves them, `--dry-run` prints the plan and changes nothing.

## Options

| Option             | Where                     | Effect                                                                                        |
| ------------------ | ------------------------- | --------------------------------------------------------------------------------------------- |
| `--root <dir>`     | `serve`, `list`, `index`  | a `node_modules` directory to walk; repeatable, and the first one wins on a duplicate package |
| `--scope <prefix>` | `serve`, `list`, `index`  | only packages whose names start with this; repeatable, matched with a plain prefix test       |
| `--model <id>`     | `index`, `serve`          | the encoder to use; rows from another model are never scored                                  |
| `--json`           | `list`, `index`, `models` | emit JSON on standard output rather than a table or a summary                                 |
| `--help`, `-h`     | anywhere                  | the help for that command, generated from the command itself                                  |
| `--version`        | on its own                | the version, on standard output                                                               |

Options are parsed against the command's own list, so an unknown flag is an error rather than a silently ignored typo. Giving a non-repeatable option twice, or leaving off a value it needs, is the same error.

## Exit codes

| Code | Means                                               | For example                                                                                                                                                                    |
| ---- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `0`  | it did what you asked                               | skills listed, or the whole catalog indexed                                                                                                                                    |
| `1`  | it ran and found a problem                          | no skills under those roots, a partial index, no SQLite in this runtime to store vectors in, a refused or failed `git deliver`                                                 |
| `2`  | the arguments were unusable, or a check found drift | an unknown command, an unknown option, a missing value; `project --check` drift, stale or undeclared outputs; a `git` fetch that failed or a sync blocked by undelivered edits |
| `3`  | an optional dependency is missing                   | `index` without `@huggingface/transformers`                                                                                                                                    |

The distinction between 1 and 3 is worth wiring into a script: 1 says the project is not what you expected, and 3 says the machine is missing something optional and the server still works without it.

**Data on stdout, everything else on stderr.** The JSON from `--json` and the string from `--version` go to standard output so they can be piped. Tables, help and messages go to standard error, which is what keeps a pipeline's input clean.

## Runtime

- Node 22 or later, or Bun 1.3 or later.
- Runtime dependencies: `@modelcontextprotocol/server`, `zod`, `semver`, `smol-toml` and `yaml`. See [dependency licence notices](https://pmcp.build/licence/).
- Vector storage uses whichever SQLite the running binary already has. Neither is a dependency; without one, the server still runs and ranking falls back.
