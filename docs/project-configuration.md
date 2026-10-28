# pmcp.toml reference

[Back to the overview](../README.md)

Every table `pmcp.toml` accepts, with its keys and defaults. Task guides cover the larger
parts: [Hooks](hooks.md), [Run several agents](sessions.md), [Git workflow](git-workflow.md),
[Browser and desktop](browser-and-desktop.md) and [Library skills](library-skills.md).

## Project config

A `pmcp.toml` at or above the working directory sets the catalog once, so a
host entry needs no flags and works from any package in the repository:

```toml
[catalog]
workspaces = [".", "packages/*"]
packages = ["docs"]
marketplaces = ["vendor/marketplace"]
```

Paths resolve against the file's directory. Keys are `roots`, `scopes`,
`workspaces`, `packages` and `marketplaces`, each a list mirroring the flag of
the same meaning, and `builtin` (boolean, default on) for the bundled free
marketplace; an unknown key is an error. A flag replaces the file's list
of its kind. `--config <file>` names another file and `--no-config` ignores it.
The nearest `pmcp.toml` is found by walking up from the working directory,
stopping at the directory that holds `.git`.

`[catalog.validation]` makes `pmcp validate` stricter than the Agent Skills
specification. Without it, only the specification is checked.

```toml
[catalog.validation]
profile = "catalog-v1"        # or "library"
deny_list = "private-terms.txt"
tiers = ["open", "free", "paid", "internal"]
```

| Key         | Type   | Default                                | Meaning                                                                                                                                                                                                                                                                                                      |
| ----------- | ------ | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `profile`   | string | none                                   | `catalog-v1`: general marketplace catalog rules (strict metadata, name equal to the directory, tier inheritance, ASCII descriptions, approval for scripts, locales); the marketplace's tier applies, else the skill's own `metadata.tier`, else `open`. `library`: the manual library skill metadata schema. |
| `deny_list` | path   | none                                   | A file of terms, one per line (`#` starts a comment), that no file of a skill may contain, compared without case. Relative to `pmcp.toml`. A finding names the list line, never the term. A missing file is an error.                                                                                        |
| `tiers`     | list   | `["open", "free", "paid", "internal"]` | The tier names this catalog uses, lowest first, in kebab case. `catalog-v1` reports a tier outside the list as `tier.unknown`; its tier-specific rules know only the four default names. The metadata schema itself takes any kebab-case name.                                                               |

Both apply to named skill directories and, with no directory named, to every
skill the catalog reaches.

## Table index

Every table pmcp reads, and where it is described. An unknown key inside one
of these tables is an error unless noted; an unknown top-level table is
ignored.

| Table                                                                                                                                                                                     | Section                                                                 |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `[catalog]`, `[catalog.validation]`                                                                                                                                                       | [Project config](#project-config)                                       |
| `[embedding]`, `[embedding.encoder]`                                                                                                                                                      | [Embedding models](embeddings.md)                                       |
| `[marketplaces.<name>]`                                                                                                                                                                   | [Marketplaces](#marketplaces)                                           |
| `[targets]`, `[skills.<name>]`, `[agents.<name>.<tool>]`, `[rules.packages]`                                                                                                              | [Native files for each agent tool](#native-files-for-each-agent-tool)   |
| `[mcp.<alias>]`                                                                                                                                                                           | [Unified project MCP configuration](#unified-project-mcp-configuration) |
| `[hooks]`, `[hooks.guards.*]`, `[[hooks.guards.custom]]`, `[hooks.checks.*]`, `[hooks.failure]`, `[hooks.report]`, `[hooks.test]`                                                         | [Hooks](hooks.md)                                                       |
| `[budget]`                                                                                                                                                                                | [Budget](#budget)                                                       |
| `[[hooks.shell]]`, `[[hooks.edit]]`                                                                                                                                                       | [Deprecated shell guards](hooks.md#deprecated-shell-guards)             |
| `[sessions]`, `[sessions.registry]`, `[sessions.pause]`, `[sessions.broadcast]`, `[sessions.mailbox]`, `[sessions.leases.<name>]`, `[sessions.roles.<name>]`                              | [Sessions](#sessions)                                                   |
| `[git]`, `[git.shared_checkout]`, `[git.worktrees]`, `[git.worktrees.sync]`, `[git.mainline]`, `[git.mainline.gate]`, `[git.mainline.deliver]`, `[git.mainline.sync]`, `[git.submodules]` | [Git workflow](git-workflow.md)                                         |
| `[logging]`, `[logging.components]`                                                                                                                                                       | [Logging](#logging)                                                     |
| `[permissions.claude]`                                                                                                                                                                    | [Claude permission rules](#claude-permission-rules)                     |
| `[ui.claude]`                                                                                                                                                                             | [Claude session panes](#claude-session-panes)                           |
| `[tui]`, `[mailbox]`                                                                                                                                                                      | [Terminal workspace](terminal-workspace.md)                             |
| `[host]`, `[[host.sessions]]`, `[[host.answers]]`, `[host.browser]`, `[host.desktop]`, `[[host.desktop.launch]]`                                                                          | [Sessions pmcp-pty hosts](#sessions-pmcp-pty-hosts)                     |
| `[harness]`                                                                                                                                                                               | [Terminal harness](terminal-harness.md#create-a-group-and-its-sessions) |

## Marketplaces

`[marketplaces.<name>]` declares a plugin marketplace once for catalog search
and for each agent tool:

```toml
[marketplaces.team]
source = { path = "packages/marketplace" }   # or { github = "owner/repo", ref = "main" } or { builtin = true }
catalog = true                               # searchable, like [catalog] marketplaces
[marketplaces.team.plugins]
review = { targets = ["claude", "codex"] }
```

`pmcp project` writes `extraKnownMarketplaces` and `enabledPlugins` in
`.claude/settings.json`, and `[marketplaces.<name>]` and
`[plugins."<plugin>@<name>"]` in the pmcp block of `.codex/config.toml`. Local
sources are written as absolute paths. Codex reads the project file only in a
trusted project and installs plugins into user state, so `pmcp doctor` prints
`codex plugin add <plugin>@<name>` for each declared plugin Codex has not
installed and reports enabled plugins the file does not declare.
`[catalog] marketplaces` remains an alias.

A marketplace name and each plugin name match `^[a-z0-9][a-z0-9-]*$`. `source`
is required and holds exactly one of `path` (resolved against the toml
directory), `github` (`owner/repo`, with an optional `ref`) or `builtin = true`.
`catalog = true` needs a path or builtin source. Each plugin's `targets` is
required and lists `claude` and/or `codex`. Without the table no marketplace is
declared.

## Native files for each agent tool

`pmcp project` writes what Claude Code, Codex, Gemini CLI, Grok Build and
Antigravity read natively, from cross-tool sources under `.agents/`
(`skills/<name>/SKILL.md`, `agents/<name>/agent.md`, `rules/*.md`) and the rest
of `pmcp.toml`:

OpenCode additionally supports project MCP and direct skill discovery, as
described in [OpenCode project support](#opencode-project-support).

```toml
[targets]
tools = ["claude", "codex", "gemini", "grok", "antigravity"]

[skills.deploy]
invocation = "user" # the person starts it; the model is not offered it

[agents.reviewer.claude]
tools = "Read, Grep" # fields one tool reads stay out of agent.md

[rules]
root = "AGENTS.md"

[mcp.skills]
command = "node"
args = ["${PROJECT_ROOT}/node_modules/@modootoday/pmcp/dist/cli.js", "serve"]
```

```sh
pmcp project              # write
pmcp project --check      # exit 2 on drift, stale or undeclared outputs
pmcp project add <name>   # copy a catalog skill or agent into .agents/
pmcp project remove <name>
pmcp doctor               # ask each installed tool what it loads
```

| Table                    | Keys                                                                                                                                                                                                                                                                                           |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `[targets]`              | `tools`: list of `claude`, `codex`, `gemini`, `grok`, `antigravity`, `opencode`. Missing means nothing is projected.                                                                                                                                                                           |
| `[skills.<name>]`        | `invocation`: `"any"` (default) or `"user"`.                                                                                                                                                                                                                                                   |
| `[agents.<name>.<tool>]` | Any keys, merged over the agent's frontmatter; Claude keeps `name`, `description`, `tools`, `model`, `effort`, Gemini keeps `name`, `description`. Codex keeps every key: see below.                                                                                                           |
| `[rules.packages]`       | `file` (required): the file name each package keeps its rules in; every tracked `<package>/<file>` is linked as `.claude/rules/<dir>/<name>.md`. `dir` (default `"pkg"`, not `"pmcp"`). `strip` (default `[]`): leading path segments dropped when deriving `<name>`. Written only for Claude. |

Rules go to `.claude/rules/<dir>/`, never the top level, because Grok Build
loads top-level `.claude/rules/*.md` in every session regardless of `paths:`.
Grok Build reads `.agents/skills` itself in a trusted folder, so pmcp writes no
skill links for it; a skill placed by hand under `.grok/skills` would shadow the
`.agents/skills` one of the same name, and `pmcp project --check` reports it as
undeclared.

Each agent becomes `.codex/agents/<codex name>.toml` for Codex, where the Codex
name is the agent's name with `-` turned into `_` (Codex refuses a hyphen where it
uses agent names), or `[agents.<name>.codex] name`, which must be lowercase
letters, digits and underscores. Two agents with the same Codex name are an error
naming both. `description` comes from the frontmatter unless the table sets it,
`developer_instructions` is always the agent's body (setting it in the table is an
error), and every other key in `[agents.<name>.codex]` is written as it is, plain
values first and then tables:

```toml
[agents.test-planner.codex]
name = "browser_test_planner"
sandbox_mode = "read-only"

[agents.test-planner.codex.mcp_servers.browser]
command = "npx"
args = ["@playwright/mcp"]
enabled_tools = ["browser_navigate", "browser_snapshot"]
```

A server that names `${PROJECT_ROOT}` is launched through `sh`, which finds
`pmcp.toml` at spawn time, so the generated files hold no machine's path.
`pmcp.lock` records what was written; a file pmcp did not write is never
overwritten. `doctor` calls no model: it reads `claude mcp list`,
`codex mcp list`, `gemini skills list`, `gemini mcp list` and
`grok inspect --json`, and skips a tool that is not installed.

## Sessions pmcp-pty hosts

`[host]` names the sessions pmcp-pty runs for this project and the few dialog
answers you allow it to give. `pmcp project` writes them to
`.agents/pmcp-pty/host.json` (the sessions) and `.agents/pmcp-pty/policy.json`
(answers, `mcp_write`, roots), pinned in `pmcp.lock` like every output, and
`pmcp doctor` reports whether they match. pmcp.toml is writable by agents, so
neither file takes effect by being projected: pmcp-pty loads only a copy you
approved. Running the host (`pmcp harness host up`) needs Linux with a
user systemd manager; on macOS it refuses, and `pmcp tui` or a harness group is
the way to run sessions there.

```toml
[host]
roots = ["."]        # every session cwd must be under one of these
mcp_write = false    # pty_turn and pty_lease over pmcp harness mcp
memory_max = "4G"    # MemoryMax of the host's systemd scope and printed unit (default 4G)

[[host.sessions]]
name = "lead"            # lowercase, digits and -; unique
runtime = "claude"       # claude, codex, gemini, agy, grok or opencode
cwd = "."                # inside the project
argv = ["claude"]        # default: the runtime's name
labels = { task = "review" }
restart = "on-exit"      # or "no" (default); max_restarts defaults to 3
env = ["GOOGLE_CLOUD_PROJECT"] # names host up passes from its own environment

[[host.answers]]
runtime = "gemini"
dialog = "tool-approval" # the dialog name pmcp-pty's profile reports
options = ["Allow once"] # option keys or labels

[host.browser]
allow_private = ["localhost:5173"] # host:port or host:*; pmcp-browser is public-only without it

[[host.desktop.launch]]
name = "terminal"        # what pmcp-desktop's launch tool takes
argv = ["xterm"]         # never a browser
```

`env` lists variable names, never values: `pmcp harness host up` reads each from
its own environment and passes it in that session's spawn request, so the session
gets it whether the pmcp-pty daemon started from this shell or from an installed
unit. A name that is unset or empty refuses that session (`host up` reports which),
and `pmcp doctor` shows each session's names as set or not set where it runs.

Login and authentication (`auth-*`), folder and workspace trust and hook
review dialogs are never answered: a `[[host.answers]]` entry naming one is a
configuration error, and pmcp-pty refuses them whatever a policy says. Paths
stay project-relative, so the projected files hold no host path.
`[host.browser]` and `[[host.desktop.launch]]` widen
[pmcp-browser and pmcp-desktop](browser-and-desktop.md) and act only
from the approved copy too; a launch entry that starts a browser is an error.

### Approving the host policy

Run `pmcp harness host approve` in your own terminal after `pmcp project`. It
prints the sessions, the answer rules, `mcp_write` and one sha256 over both
projected files, and approves only when you type the first 8 hex digits of
that hash. The approved copy goes to
`$XDG_STATE_HOME/pmcp/host-approvals/<project id>/` (directory 0700, files
0600; the `[sessions] state_dir` override does not apply), and
`pmcp-pty daemon --host <that directory>` loads only that copy, after checking
it still matches its own approval. A later projection that differs is
reported by `pmcp doctor` and `pmcp harness host status`, and the approved
copy stays in force until you approve again.

`approve` refuses without an interactive terminal, when `PMCP_PTY_*` or a
coding agent's session variables are set, and when an ancestor process is a
coding agent or pmcp-pty. With `[host]` declared, the `shell.host_approval`
guard (deny by default; set `[hooks.guards.shell] host_approval` to change it)
blocks agents' commands that run `host approve` or touch the approvals
directory, and their edits there.

These checks run as your own user, like the agents themselves. They stop an
accident and an agent that was told to approve; they are not a security
boundary, since any process running as you can write the approvals directory
directly. A real boundary needs the approvals stored under a different user or
owned by root.

## Browser and desktop for agents

pmcp-browser and pmcp-desktop, and how to declare them: [Browser and desktop](browser-and-desktop.md).

## Claude permission rules

`[permissions.claude]` declares Claude Code permission rules. `pmcp project`
adds them to `permissions.allow`, `permissions.ask` and `permissions.deny` in
`.claude/settings.json` when `claude` is in `[targets] tools`:

```toml
[permissions.claude]
ask = ["Read(.env)", "Read(**/*.bak.*)", "Bash(git push:*)", "Bash(git stash:*)"]
deny = ["WebFetch(domain:internal.example)"]
```

| Table                  | Keys                                                                                                                                                     |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `[permissions.claude]` | `allow`, `ask`, `deny`: lists of native Claude rules, kept verbatim. Repeats within a list are dropped; one rule in two lists is an error. No other key. |

Each rule is a Claude permission expression: a tool name (`Bash`, `Read`,
`Edit`, `Write`, `Glob`, `Grep`, `WebFetch`, `WebSearch`, `Agent`, `Task`,
`Skill` and the other built-in tools), optionally followed by a specifier in
parentheses, or an MCP name such as `mcp__docs` or `mcp__docs__search`.
`WebFetch` takes `domain:<host>`; a `Bash` prefix `:*` must end the specifier.
pmcp checks only this structure. It never expands globs or rewrites paths, so
`Read(.env)` stays `Read(.env)`.

pmcp owns only the entries it inserted, and records them in `pmcp.lock`. A rule
that was already in the list is borrowed: it satisfies the declaration but
stays unmanaged and survives when the declaration goes. Entries pmcp did not
write are never removed or reordered, and `defaultMode` and every other
setting are left alone. A missing table declares nothing; an empty list, a
removed list or a removed table removes the entries pmcp owns in that list.

`pmcp project --check` reports `drift` for a declared rule that is missing and
for an owned rule that is no longer declared. It reports `conflict` when an
owned entry was edited or removed by hand, or when the list is not a list of
strings; `pmcp project` then refuses to write until the native file is
reviewed. `pmcp doctor` shows how many entries each list owns and borrows, or
`none declared`.

A declared rule that also sits unmanaged in another list, for example a hand
written `deny` for a rule declared in `ask`, is an `overlap`. Claude's own
precedence decides it, so `--check` and `doctor` show it as a warning and
nothing is removed or refused. `pmcp project` also refuses to write when
`.claude/settings.json` changed while it was planning; run it again.

Codex is never written: its native command rules are a separate feature, and
the hook guards stay its enforcement.

## Unified project MCP configuration

Declare each MCP server once in pmcp.toml. The projector writes the native
project files for all selected runtimes. A server can narrow its targets:

```toml
[mcp.docs]
url = "https://example.com/mcp"

[mcp.private-api]
url = "https://example.com/private-mcp"
targets = ["claude", "codex", "gemini", "grok"]
bearer_token_env_var = "PRIVATE_MCP_TOKEN"
header_env = { "X-Workspace" = "PRIVATE_MCP_WORKSPACE" }

[mcp.local-service]
command = "my-mcp-server"
env_vars = ["MY_SERVICE_KEY"]
cwd = "${PROJECT_ROOT}"

[mcp.local-service.native.codex]
startup_timeout_sec = 30

[mcp.local-service.native.gemini]
timeout = 120000
```

url means Streamable HTTP; Gemini receives httpUrl. Legacy SSE is not imported
as HTTP. headers contains literal nonsecret headers, header_env maps header
names to environment variable names, and bearer_token_env_var references a
token without writing its value. With auth = "native" (the default), each runtime
retains its own OAuth session.
Antigravity HTTP header projection is not qualified and is rejected; explicitly
limit those servers to supported targets. tools maps to Gemini includeTools and
Codex enabled_tools; it is not a cross-runtime security boundary. Native timeout
options retain each runtime's documented names and units. Unknown fields fail.

Import explicitly selected native configurations. Preview is the default:

```sh
pmcp project import-mcp --source claude:/path/to/native.json
pmcp project import-mcp --source codex:/path/to/config.toml --name docs --write
pmcp project
pmcp project --check
```

Repeat source and name to select multiple inputs. Conflicting aliases, missing
requested names, unsupported authentication fields and credential-bearing URLs
block import. Source contents and credential values are not printed. Sources
are never rewritten. Review plugin-provided servers separately to avoid
duplicating a server the runtime already loads.

Literal stdio environment values remain in their source file. The importer
stores an env_from reference containing file and an RFC 6901 JSON pointer:

```toml
[mcp.local-service.env_from.MY_SERVICE_KEY]
file = "~/.config/my-client/settings.json"
pointer = "/mcpServers/local-service/env/MY_SERVICE_KEY"
```

The generated entry invokes pmcp project exec-mcp for that declared server.
It reads only the referenced values and passes them to the child process, using
inherited stdio. JSON and TOML sources are supported. The source must remain
available; rotating its value takes effect on the next server launch. A project
installed CLI is referenced relative to the project; otherwise pmcp must be on
PATH. Configurations using env_from require this release on every runtime host.

Writes retain private backups in ~/.cache/pmcp/project-backups, outside the
project. Receipts record file hashes and absent paths. A conflicting unmanaged
native alias is refused before projection writes. The managed TOML block and
JSON keys preserve unrelated settings. Inspect the reported backup before
restoring any file that another process may have edited.

Configuration references: [Codex](https://developers.openai.com/codex/config-reference/),
[Claude Code](https://code.claude.com/docs/en/mcp),
[Gemini CLI](https://geminicli.com/docs/tools/mcp-server/),
and [Grok Build](https://docs.x.ai/build/features/mcp-servers).

### Antigravity

Antigravity receives a native project plugin at `.agents/plugins/pmcp-mcp` with
`plugin.json` and `mcp_config.json`. Projection removes only lock-owned entries
from the earlier `.agents/mcp_config.json` artifact and backs up both layouts.
Antigravity's global mcp list does not enumerate project plugin servers;
validate the generated plugin with `agy plugin validate`.
Its HTTP entries use `serverUrl`, accepted by the installed plugin validator.

## OpenCode project support

Add opencode to targets.tools to project MCP entries into the project-root
opencode.json. PMCP owns only its declared mcp entries and user-only skill
permissions; existing provider, model, other servers and permission rules are
preserved. An unmanaged conflicting entry is refused. JSONC projection is not
supported; reconcile a project opencode.jsonc before projecting opencode.json.

Local servers use type=local, a command array and environment. Remote servers
use type=remote, url and native {env:NAME} header references. Optional
mcp.<name>.native.opencode.timeout uses milliseconds. Per-server tool filtering,
MCP configuration import and mailbox runtime binding are not qualified for
OpenCode; explicitly limit those servers to other targets when needed.

OpenCode discovers .agents/skills directly, so PMCP creates no skill copies or
links. For invocation=user, projection sets permission.skill.<name> to deny:
the model's skill list omits that name, while the native /<name> command still
loads its original SKILL.md and accepts user arguments (measured: see
[Compatibility](compatibility.md#installation-and-packaging)). It controls automatic skill selection, not
arbitrary file access. Native global skill discovery remains a user preference.

pmcp doctor checks opencode debug skill and opencode mcp list without calling
a model. Discovery does not imply automatic visibility or native tool invocation.
Memory reporting, shell-hook enforcement, canonical agent projection and
terminal-harness support are not part of this target's current qualification.
OpenCode does not run Claude project hooks automatically.

See the [OpenCode MCP configuration](https://opencode.ai/docs/mcp-servers/),
[Agent Skills](https://opencode.ai/docs/skills/) and
[configuration precedence](https://opencode.ai/docs/config/).

## Shared remote MCP authentication

Use `auth = "pmcp"` to let Claude, Codex, Gemini, Antigravity, Grok and
OpenCode share one remote MCP login (only the Claude and Codex entries have run
live):

```toml
[mcp.remote]
url = "https://example.com/mcp"
auth = "pmcp"
targets = ["claude", "codex"]
```

Run `pmcp project`, then `pmcp mcp login remote`. The projected stdio entries
run `pmcp project exec-mcp remote`; the proxy connects to the declared Streamable
HTTP endpoint. The login command prints an authorization URL without opening
a browser. Complete the loopback callback or paste the callback URL or code.
For a later completion, use `pmcp mcp login remote --no-wait`, then
`pmcp mcp login remote --code <callback-url-or-code>`. Issuers must support
PKCE S256 and dynamic client registration, or supply `--client-id` for a
pre-registered public client. Discovery follows the resource's OAuth metadata.

For bearer authentication, declare `bearer_token_env_var` and run login with
that variable set, or pass `--bearer-env <variable-name>`. The value is stored
privately and is never projected into runtime configuration or printed.
`pmcp mcp status remote` reports only credential presence, UTC expiry and scopes.
`pmcp mcp logout remote` clears the local credentials and requests remote
revocation when the issuer advertises it.

Credentials live in `$XDG_STATE_HOME/pmcp/credentials/<name>.json`, defaulting to
`~/.local/state/pmcp/credentials/`. Files use mode 0600 and the credential
directory uses mode 0700. Credentials are bound to the declared server URL.
Processes reread credentials under an OS lock before refreshing; refresh-token
rotation is stored atomically. This implementation requires the `flock` command.
An expired or revoked session reports an authentication error rather than
starting interactive login inside the MCP connection.

The CLI must be installed in the project or available as `pmcp` on PATH.
Codex receives environment-name references for `XDG_STATE_HOME` and any declared
header environment variables. `auth = "native"` preserves existing entries,
OAuth ownership and env_from behavior. Provider authentication remains native.

## Hooks

Guards, checks and session bookkeeping for every targeted runtime, and which runtime supports
what: [Hooks](hooks.md).

## Sessions

Sessions coordinate agents working in one repository and its worktrees. State
lives in one directory shared by every checkout of the repository.

| `[sessions]` key | Type   | Default                                                     | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ---------------- | ------ | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `store`          | string | `"files"`                                                   | The only store.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `state_dir`      | path   | `$XDG_STATE_HOME/pmcp/projects/<id>` (`~/.local/state/...`) | `<id>` is the first 16 hex digits of the sha256 of the git common directory. `~`, `~/` and `$HOME/` expand to the home directory and a relative path is relative to the main checkout: the directory holding `pmcp.toml`, taken in the worktree of the git common directory, so the main checkout and every linked worktree share one state. Outside git it is relative to the directory holding `pmcp.toml`. The hooks, the Claude Code session panes and the git commands resolve it the same way; so does `[git.mainline.gate] tree`. |

`store` and `state_dir` alone enable nothing; each feature has its own table:

| Table                      | Keys                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Effect                                                                                                                                          |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `[sessions.registry]`      | `liveness` (`"pid_heartbeat"`, the only value), `stale_minutes` (default `30`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Records each session with its process and heartbeat; `pmcp sessions status` lists them.                                                         |
| `[sessions.pause]`         | `mode` (`deny` default, `ask`, `warn`, `off`), `refuses` (`"mutating"`), `scripts` (regular expressions, default `[]`: a `node` script matching one also counts as mutating, e.g. your own delivery or sync script), `commands` (argv prefixes that also count, replacing the default `docker` compose/build/push/run/rm/stop/restart and `wrangler` deploy/publish/secret), `script_names` (regular expressions for `bun`, `npm`, `pnpm` or `yarn run <name>`, default `["^git:", "^docker:", "^deploy", "^release", "^publish"]`); git commits, pushes and the like and package installs always count | While `pmcp sessions pause` is in effect, edits and mutating commands are refused for every session but the one that paused; reading continues. |
| `[sessions.broadcast]`     | `keep` (default `10`), `deliver_on` (default `["session_start", "prompt", "before_tool"]`; also `after_tool`, `stop`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Delivers `pmcp sessions broadcast` text once to each session, as context on the listed events.                                                  |
| `[sessions.leases.<name>]` | `path` (string, shown in the message and used by git delivery), `blocks` (required list of argv prefixes), `file` and `events` (optional paths: absolute, `~/…`, or `${gate_dir}/…` for the directory of the gate tree)                                                                                                                                                                                                                                                                                                                                                                                 | While another session holds lease `<name>`, commands starting with a listed prefix are denied until its delivery finishes.                      |
| `[sessions.roles.<name>]`  | `agent_type` (default `<name>`, also matches `plugin:<name>`), `allow_edits` (default `false`), `allow_commands` (list of argv prefixes, default `[]`)                                                                                                                                                                                                                                                                                                                                                                                                                                                  | A subagent of that type may edit only if allowed and run only the listed commands. Claude only.                                                 |

These tables have no `mode`, except pause. Without `[sessions.registry]` no
session is recorded, and `[ui.claude]` refuses to project.

### `[sessions.mailbox]`

Addressed messages between sessions, and between you and them. A missing table leaves
the mailbox off; a declared one, even empty, turns it on.

| Key             | Type   | Default | Meaning                                                                     |
| --------------- | ------ | ------- | --------------------------------------------------------------------------- |
| `enabled`       | bool   | `true`  | `false` keeps the table but turns the mailbox off.                          |
| `ttl_minutes`   | number | `1440`  | Default lifetime of a message; `--ttl` overrides it per message.            |
| `max_delivered` | number | `5`     | At most this many new messages are shown at once, plus a count of the rest. |
| `audit`         | bool   | `true`  | Append a line per sent, delivered, acked and expired event.                 |
| `wake`          | bool   | `false` | Wake idle recipients on every send, as `--wake` does for one message.       |

Each message is one file, `<state>/messages/<id>.json`, created atomically and
never rewritten: `id`, `from` (session and alias), `to`, `subject`, `body`,
`createdAt`, `expiresAt`, `replyTo`, `once`. `to` lists selectors: `all`,
`session:<id>` (a prefix of at least eight characters works), `alias:<name>`,
`role:<name>` (a `[sessions.roles]` name or the agent type), or `worktree:<path>`
(a linked worktree's path, or its directory name; `desk:<path>` is an older
spelling that still works). A message to `all` reaches the
sessions that were running when it was sent; a session the registry records
later does not get earlier broadcasts. Delivery and acknowledgement are
empty markers under `<state>/inbox/<session>/`, so a message is never edited
for them. `<state>/messages.jsonl` is the append-only audit.

The hooks deliver each unacknowledged message addressed to a session once,
through that runtime's context channel; on a runtime that does not show
context at an event, the notice is held for the next one that does. Later
events notice only messages that arrived since, with a count of earlier
unacknowledged ones. Delivery is recorded and never counts as an
acknowledgement. A message sent with `--once` says it is a one-time request,
so the recipient does not keep its instructions as standing rules.

```sh
pmcp sessions send --to alias:reviewer --to role:delivery --subject deploy --once "Hold the deploy until 14:00"
echo "longer body" | pmcp sessions send --to all -
pmcp sessions inbox [--session <id>] [--all] [--json]
pmcp sessions ack <id>... [--session <id>]
pmcp sessions reply <id> "Done"
pmcp sessions send --wake --to alias:reviewer "CI is green again"
pmcp sessions sweep
```

A recipient that is idle sees mail only at its next event. With `--wake`, or
`wake = true` in the table, `send` and `reply` also start a turn in each idle
recipient whose runtime allows it, and the woken session's hooks then deliver
the mail as usual; the wake itself carries only a count, the subjects and one
exact command to run, `pmcp sessions inbox --session <id>`. Each attempt is an
audit line (`woken`, with the transport and channel), and `pmcp doctor` shows
each live session's last wake.

- Any runtime hosted by pmcp-pty: the session-start hook records the host's
  socket, session and instance from `PMCP_PTY_*` when the host is the
  runtime's parent or grandparent (a runtime started from a hosted session's
  shell inherits the variables but is not recorded). `send --wake` asks the
  host for one short `turn`; the host picks the channel (Claude inbox, OpenCode
  server, Codex queue, Grok leader or a guarded screen write) and its receipt
  is in `send --json`. A refused turn, such as one behind an open dialog,
  leaves the mail for the next event. The same hooks report each turn's start
  and end (with the last assistant message) and permission notices to the
  host, which ends a turn on that before trusting the screen. A hosted
  session gets mail only on the wake turn itself (a prompt starting
  `pmcp mail:`): as context on other prompts the notice took over turns
  pmcp-pty sent. The two items below are for sessions pmcp-pty does not host.
- Claude Code: through the session's documented
  [cross-session inbox](https://code.claude.com/docs/en/cross-session-messaging),
  found in `~/.claude/sessions/<pid>.json`, which pmcp only reads. The target's
  own inbound controls apply: a session in `bypassPermissions` without
  `crossSessionInbound = "accept"` holds the wake for approval, and a wake can
  approve nothing.
- OpenCode: `POST /session/<id>/prompt_async` on the server the session runs
  on, which the generated plugin records; HTTP basic auth from
  `OPENCODE_SERVER_PASSWORD` (user `OPENCODE_SERVER_USERNAME`, default
  `opencode`).
- Codex, Gemini, Antigravity and Grok outside pmcp-pty have no supported way to
  start a turn in a running session; their mail waits for the next event.
  `pmcp sessions status` and `pmcp doctor` show which live sessions can be
  woken.

`--session <id>` acts as that session and `--by <name>` as a named sender
outside one; the notice a session receives spells out its commands with its
own `--session`. Those commands, and the wake text, say `pmcp` only when the
`pmcp` on PATH is the CLI that projects this checkout (its own install, else
the one that last projected it); otherwise they name that CLI as
`node '<path>/dist/cli.js'`, and `pmcp doctor` warns. Without either, a command run inside a runtime acts as that
runtime's session: the live session whose runtime process is its nearest
ancestor, else the id the runtime exposes to tool commands
(`CLAUDE_CODE_SESSION_ID`, `CODEX_THREAD_ID`, `ANTIGRAVITY_CONVERSATION_ID`,
`GROK_SESSION_ID`; Gemini and OpenCode expose none). When it cannot tell, it
warns and acts as `operator`. `sweep` also deletes expired messages and their
markers.

`pmcp sessions status` and `pmcp doctor` name live sessions that should be
restarted to get the current hooks: one started under an older (or untracked)
`policy.json`, which matters when new hook events were added, and a Codex
session started before `.codex/hooks.json` last changed, since Codex reads its
hook file only when a session starts.

With the mailbox on, `pmcp sessions broadcast` also sends its text as a
message to `all`, and the mailbox delivers it instead of
`[sessions.broadcast]`; `broadcast.json` and each session's `seenBroadcast`
are still written, so `pmcp sessions status`, the session list and the
Claude Code session panes read broadcasts as before. `unbroadcast` withdraws those
messages too.

## Git workflow

Worktrees, delivery to the mainline and main checkout sync: [Git workflow](git-workflow.md).

## Budget

`[budget]` sets limits on what every agent session loads and on paths the
project keeps out of its tree. `pmcp project --check` exits 2 when one is
exceeded, naming each, and `pmcp status` shows the measurements beside the
limits (its JSON gains `budget: {rows, problems}`, and an exceeded limit counts
as drift). Every key is optional; nothing is checked without the table.

| Key             | Type      | Meaning                                                                                                                                                              |
| --------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `root_bytes`    | integer   | Largest size of each of `AGENTS.md`, `CLAUDE.md` and `GEMINI.md` at the root that is a file (a symbolic link to another is not measured twice).                      |
| `root_lines`    | integer   | Largest line count of the same files.                                                                                                                                |
| `package_bytes` | integer   | Largest size of each tracked `AGENTS.md` below the root, and of each `[rules.packages] file`.                                                                        |
| `skills_max`    | integer   | Most skills under `.agents/skills` (each a folder with a `SKILL.md`), the skills every runtime is offered.                                                           |
| `forbid_paths`  | glob list | Tracked paths that must not exist: `*` within a segment, `**` across segments, `?` one character; a glob naming a directory covers everything below it (`docs/adr`). |

```toml
[budget]
root_bytes = 16000
root_lines = 300
package_bytes = 8000
skills_max = 40
forbid_paths = [".spec/**", "docs/adr"]
```

## Logging

| `[logging]` key | Type   | Default                                          | Allowed                                   |
| --------------- | ------ | ------------------------------------------------ | ----------------------------------------- |
| `level`         | string | `"info"`                                         | `error`, `warn`, `info`, `debug`, `trace` |
| `format`        | string | `"jsonl"`                                        | `jsonl` only                              |
| `max_file_mb`   | number | `20`                                             | greater than 0                            |
| `keep_days`     | number | `14`                                             | greater than 0                            |
| `redact`        | list   | `["secret_values", "prompt_text", "env_values"]` | any subset                                |
| `components`    | table  | `{}`                                             | `<component> = "<level>"`                 |

The `PMCP_LOG` environment variable overrides the level. `[hooks] error_log`
switches hook logging on or off. Read the logs with `pmcp logs`. Guard verdicts are logged at
`debug` from the `hooks.entry` component, so `components = { "hooks.entry" = "debug" }`
records them without raising the rest; see [Hooks](hooks.md#hooksguardsgroupname).

## Claude session panes

`[ui.claude]` installs the session panes into Claude Code: `sessions_pane`,
`status_band`, `commands` and `hold_foreign_edits`, all booleans defaulting to
`true`. `hold_foreign_edits` asks before editing a file another live session
edited. The panes and the hold know linked worktrees by `[git.worktrees] root`
(default `.claude/worktrees`). It needs `[sessions.registry]`, and is written only when `claude` is
in `[targets] tools`. Without the table nothing is installed. `pmcp doctor`
shows the projected switches, or a failure until `pmcp project` writes them; it
cannot tell whether a running Claude Code loaded the session panes.

## A complete example

A project with two runtimes, the full guard set, sessions, the git workflow and
a team marketplace:

```toml
[catalog]
workspaces = [".", "packages/*"]

[targets]
tools = ["claude", "codex"]

[mcp.skills]
command = "node"
args = ["${PROJECT_ROOT}/node_modules/@modootoday/pmcp/dist/cli.js", "serve"]

[skills.deploy]
invocation = "user"

[agents.reviewer.claude]
tools = "Read, Grep, Glob"
model = "inherit"
effort = "high"

[hooks]
targets = ["claude", "codex"]
ask_fallback = "deny"

[hooks.guards.shell.in_place_edit]
mode = "ask"

[hooks.guards.shell.heredoc]

[hooks.guards.shell.stdin_interpreter]

[hooks.guards.shell.compose_teardown]

[hooks.guards.shell.host_approval]

[hooks.guards.shell.secret_exfiltration]
mode = "graded"

[[hooks.guards.shell.secret_exfiltration.value_commands]]
binary = "secrets-cli"
read = ["read", "env get"]
publish = ["deploy", "secret put", "secret delete"]

[hooks.guards.shell.runaway_regex]
threshold = 255

[hooks.guards.git.push_without_verify]

[hooks.guards.git.forced_branch_move]

[hooks.guards.git.stage_all]

[hooks.guards.git.gate_bypass_env]
names = ["ALLOW_DIRECT_PUSH", "SKIP_GATE"]

[[hooks.guards.custom]]
name = "source-formatting"
command = ["node", ".agents/guards/source-formatting.mjs"]
targets = ["codex"]
on = "after_edit"

[hooks.checks.after_edit]
validator_glob = ".agents/skills/*/scripts/validate.ts"
command = ["node", "{validator}"]

[hooks.checks.on_stop]

[sessions]
state_dir = ".pmcp-state"

[sessions.registry]

[sessions.pause]

[sessions.broadcast]

[sessions.mailbox]
ttl_minutes = 1440
max_delivered = 5

[sessions.leases.lockfile]
path = "package-lock.json"
blocks = [["npm", "install"], ["npm", "ci"], ["pmcp", "git", "deliver"]]

[sessions.roles.delivery]
allow_commands = [["pmcp", "git", "deliver"], ["git", "log"], ["git", "status"]]

[git]
remote = "origin"

[git.shared_checkout]

[git.mainline]
branch = "main"

[git.mainline.gate]
command = ["npm", "test"]

[git.mainline.deliver]

[git.mainline.sync]
install = ["npm", "ci"]
install_when_changed = ["package-lock.json"]

[git.worktrees]
bootstrap = ["sh", "scripts/setup-worktree.sh"]
link_from_main = [".env"]

[git.worktrees.sync]
install_after_move = "background"
notice_paths = ["AGENTS.md", "pmcp.toml"]

[git.submodules]

[logging]
level = "warn"

[ui.claude]

[permissions.claude]
ask = ["Read(.env)", "Bash(git push:*)"]

[marketplaces.team]
source = { github = "example/team-marketplace" }

[marketplaces.team.plugins]
review = { targets = ["claude", "codex"] }
```

## Native memory metadata

```sh
pmcp doctor --memory --json
pmcp doctor --memory --tool codex
```

This explicit operation reports selected runtimes' native memory configuration
and path existence. It reads no memory body, index or transcript, writes no
configuration, connects to no MCP server and makes no provider request.
Ordinary doctor output is unchanged.

The report distinguishes enabled, disabled, unknown and unsupported. Path
existence does not establish activation. Where native metadata cannot identify
a project-specific location, pathScope=base reports only the storage parent;
the project identifier is not guessed. Supported native home overrides are
respected. Codex uses its native features listing. Claude and Grok report
explicit user settings, with active session overrides and unverified project
trust left unknown. Gemini context filenames and the global GEMINI.md file
are separate from unexposed memory-tool activation. Antigravity trajectories
are not reported as a memory store. pmcp does not synchronize or inject memory.
