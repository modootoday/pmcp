# Project configuration

[Back to the overview](../README.md)

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
```

| Key         | Type   | Default | Meaning                                                                                                                                                                                                                                                 |
| ----------- | ------ | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `profile`   | string | none    | `catalog-v1`: the marketplace catalog rules (metadata, tier, trigger wording, ASCII in the open tier, locales); the marketplace's tier applies, else the skill's own `metadata.tier`, else `open`. `library`: the manual library skill metadata schema. |
| `deny_list` | path   | none    | A file of terms, one per line (`#` starts a comment), that no file of a skill may contain, compared without case. Relative to `pmcp.toml`. A finding names the list line, never the term. A missing file is an error.                                   |

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
| `[hooks]`, `[hooks.guards.*]`, `[[hooks.guards.custom]]`, `[hooks.checks.*]`                                                                                                              | [Hooks](#hooks)                                                         |
| `[[hooks.shell]]`, `[[hooks.edit]]`                                                                                                                                                       | [Operator shell guards](#operator-shell-guards)                         |
| `[sessions]`, `[sessions.registry]`, `[sessions.pause]`, `[sessions.broadcast]`, `[sessions.mailbox]`, `[sessions.leases.<name>]`, `[sessions.roles.<name>]`                              | [Sessions](#sessions)                                                   |
| `[git]`, `[git.shared_checkout]`, `[git.worktrees]`, `[git.worktrees.sync]`, `[git.mainline]`, `[git.mainline.gate]`, `[git.mainline.deliver]`, `[git.mainline.sync]`, `[git.submodules]` | [Git workflow](#git-workflow)                                           |
| `[logging]`, `[logging.components]`                                                                                                                                                       | [Logging](#logging)                                                     |
| `[permissions.claude]`                                                                                                                                                                    | [Claude permission rules](#claude-permission-rules)                     |
| `[ui.claude]`                                                                                                                                                                             | [Claude session panes](#claude-session-panes)                           |
| `[tui]`, `[mailbox]`                                                                                                                                                                      | [Terminal workspace](terminal-workspace.md)                             |
| `[host]`, `[[host.sessions]]`, `[[host.answers]]`, `[host.browser]`, `[host.desktop]`, `[[host.desktop.launch]]`                                                                          | [Sessions pmcp-pty hosts](#sessions-pmcp-pty-hosts)                     |

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
| `[agents.<name>.<tool>]` | Any keys, merged over the agent's frontmatter; Claude keeps `name`, `description`, `tools`, `model`, `effort`, Gemini keeps `name`, `description`.                                                                                                                                             |
| `[rules.packages]`       | `file` (required): the file name each package keeps its rules in; every tracked `<package>/<file>` is linked as `.claude/rules/<dir>/<name>.md`. `dir` (default `"pkg"`, not `"pmcp"`). `strip` (default `[]`): leading path segments dropped when deriving `<name>`. Written only for Claude. |

Rules go to `.claude/rules/<dir>/`, never the top level, because Grok Build
loads top-level `.claude/rules/*.md` in every session regardless of `paths:`.
A server that names `${PROJECT_ROOT}` is launched through `sh`, which finds
`pmcp.toml` at spawn time, so the generated files hold no machine's path.
`pmcp.lock` records what was written; a file pmcp did not write is never
overwritten. `doctor` calls no model: it reads `claude mcp list`,
`codex mcp list`, `gemini skills list`, `gemini mcp list` and
`grok inspect --json`, and skips a tool that is not installed.

## Sessions pmcp-pty hosts

`[host]` names the sessions pmcp-pty runs for this project and the few dialog
answers the operator allows it to give. `pmcp project` writes them to
`.agents/pmcp-pty/host.json` (the sessions) and `.agents/pmcp-pty/policy.json`
(answers, `mcp_write`, roots), pinned in `pmcp.lock` like every output, and
`pmcp doctor` reports whether they match. pmcp.toml is writable by agents, so
neither file takes effect by being projected: pmcp-pty loads only a copy the
operator approved. Running the host (`pmcp harness host up`) needs Linux with a
user systemd manager; on macOS it refuses, and `pmcp tui` or a harness group is
the way to run sessions there.

```toml
[host]
roots = ["."]        # every session cwd must be under one of these
mcp_write = false    # pty_turn and pty_lease over pmcp harness mcp

[[host.sessions]]
name = "lead"            # lowercase, digits and -; unique
runtime = "claude"       # claude, codex, gemini, agy, grok or opencode
cwd = "."                # inside the project
argv = ["claude"]        # default: the runtime's name
labels = { task = "review" }
restart = "on-exit"      # or "no" (default); max_restarts defaults to 3

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

Login and authentication (`auth-*`), folder and workspace trust and hook
review dialogs are never answered: a `[[host.answers]]` entry naming one is a
configuration error, and pmcp-pty refuses them whatever a policy says. Paths
stay project-relative, so the projected files hold no host path.
`[host.browser]` and `[[host.desktop.launch]]` widen
[pmcp-browser and pmcp-desktop](#browser-and-desktop-for-agents) and act only
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

Claude Code and Codex offer browser and computer use only through their
desktop apps, not on a Linux server. Two MCP servers built from this
repository cover that ground for every runtime pmcp projects to:

- `pmcp-browser` (`crates/pmcp-plugin-browser-use`): an isolated Chromium,
  headless, with a fresh profile per launch. It reaches public http(s) sites
  only: every request goes through its own proxy, which refuses loopback,
  private, link-local, metadata and CGNAT addresses and every port but 80 and 443. Local schemes such as `file:` are blocked in the page.
- `pmcp-desktop` (`crates/pmcp-plugin-computer-use`): an Xvfb desktop driven
  through screenshots and XTEST input, for any X11 app.

Each runs in its own memory-capped systemd scope (2G and 512M by default),
and `pmcp-browser` allows two at a time on the host. Both have `doctor`
(read-only, with the exact fix) and `setup --plan`; root steps are printed,
never run. Both ship in the Linux platform package npm installs with PMCP
(glibc 2.35 or later), which does not put them on PATH. Declare them like
any MCP server with the bare name as `command`; `pmcp project` resolves it to
the installed binary, so pmcp.toml names no host path:

```toml
[mcp.pmcp-browser]
command = "pmcp-browser"
args = ["serve", "--approved", "<the directory pmcp harness host status reports>"]

[mcp.pmcp-desktop]
command = "pmcp-desktop"
args = ["serve", "--geometry", "1440x900x24"]
```

`pmcp doctor` reports where each resolved, or why not (no platform
package for this host, as on macOS); an unresolved name runs from PATH. An
absolute `command`, such as your own build, is kept as written.

The names avoid Claude Code's built-in `computer-use`. `--approved` is
optional: without it the browser is public-only and the desktop launches
nothing. `[host.browser] allow_private` and `[[host.desktop.launch]]` come
into force only through `pmcp harness host approve`. Running the browser
headed on the desktop's display also needs the managed Chromium policy that
`pmcp-browser setup --plan` prints for the operator to install.

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

Antigravity receives a native project plugin at .agents/plugins/pmcp-mcp with
plugin.json and mcp_config.json. Projection removes only lock-owned entries
from the earlier .agents/mcp_config.json artifact and backs up both layouts.
Antigravity's global mcp list does not enumerate project plugin servers;
validate the generated plugin with agy plugin validate.
Its HTTP entries use serverUrl, accepted by the installed plugin validator.

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
loads its original SKILL.md and accepts user arguments. This was qualified with
OpenCode 1.18.33 using isolated native CLI calls and local scripted responses,
without an external model call. It controls automatic skill selection, not
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

### `[hooks]`

| Key                  | Type         | Default                                        | Meaning                                                                                                                                                                 |
| -------------------- | ------------ | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `targets`            | list         | `[targets] tools` limited to `claude`, `codex` | Runtimes that receive the hook bundle: `claude`, `codex`, `gemini`, `antigravity`, `grok`, `opencode`. The last four are used only when listed here.                    |
| `ask_fallback`       | string       | `"deny"`                                       | What an ask becomes on a runtime without ask (Codex, Gemini, Antigravity, Grok, OpenCode): `deny`, `warn`, or `refuse` to make projection fail while any guard may ask. |
| `error_log`          | bool or path | `true`                                         | `true` writes JSONL logs under the state directory's `logs/`; a project-relative path writes one file there instead; `false` turns hook logging off.                    |
| `emergency_off_file` | path         | none                                           | While this file exists every guard passes. `~`, `$HOME/` and absolute paths are allowed; other paths are relative to the project.                                       |

### `[hooks.guards.<group>.<name>]`

Each built-in guard is one table. `mode` is the only key the option-less
guards take; an unknown option is an error. Modes: `deny` and `ask` replace
the guard's verdict with that mode, `warn` turns the reason into context the
agent reads, `off` drops the guard, and `graded` keeps the guard's own split
between ask and deny.

| Table                                      | Default mode | Modes                        | Refuses                                                                                                              |
| ------------------------------------------ | ------------ | ---------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `[hooks.guards.shell.in_place_edit]`       | deny         | deny, ask, warn, off         | `sed -i`, `perl -i`, `awk -i inplace`: edits without a diff.                                                         |
| `[hooks.guards.shell.heredoc]`             | deny         | deny, ask, warn, off         | Heredocs and here-strings, whose body the shell expands silently.                                                    |
| `[hooks.guards.shell.stdin_interpreter]`   | ask          | deny, ask, warn, off         | An interpreter reading its program from stdin (`python3 -`, `cat x.py \| python3`).                                  |
| `[hooks.guards.shell.compose_teardown]`    | deny         | deny, ask, warn, off         | `docker compose down`, and `stop`, `rm` or `kill` with no service named: they hit every service.                     |
| `[hooks.guards.shell.secret_exfiltration]` | graded       | deny, ask, warn, off, graded | Reading a credential asks; sending one over the network, or changing a live one, denies.                             |
| `[hooks.guards.shell.host_approval]`       | deny         | deny, ask, warn, off         | `host approve`, and commands or edits touching the host approvals directory. On by itself when `[host]` is declared. |
| `[hooks.guards.git.push_without_verify]`   | deny         | deny, ask, warn, off         | `git push --no-verify`.                                                                                              |
| `[hooks.guards.git.forced_branch_move]`    | deny         | deny, ask, warn, off         | Forcing a branch that is checked out in another working tree.                                                        |
| `[hooks.guards.git.gate_bypass_env]`       | deny         | deny, ask, warn, off         | Setting a named gate-bypass variable where it takes effect, and optionally `--no-verify` on any git command.         |
| `[hooks.guards.git.stage_all]`             | deny         | deny, ask, warn, off         | `git add -A`, `git add .`, `git commit -a` and similar; stage explicit paths.                                        |

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

### `[[hooks.guards.custom]]`

A project script under `.agents/guards/` that decides like a built-in guard.

| Key          | Type      | Default          | Meaning                                                                                                                                                                                              |
| ------------ | --------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`       | string    | required         | `^[a-z0-9][a-z0-9-]*$`, unique across custom, shell and edit entries.                                                                                                                                |
| `command`    | argv list | required         | The first or second element is the script, which must exist inside `.agents/guards/`; its sha256 is pinned in `policy.json`.                                                                         |
| `targets`    | list      | required         | Any `[hooks] targets` runtime. A runtime in `[hooks] targets` runs it in the hook bundle; otherwise Codex, Gemini and Antigravity use the shell adapter, and Claude, Grok and OpenCode are an error. |
| `timeout_ms` | integer   | `15000`          | 100 to 60000.                                                                                                                                                                                        |
| `on`         | string    | `"before_shell"` | `before_shell` or `after_edit`.                                                                                                                                                                      |

The script receives the JSON contract described under
[Operator shell guards](#operator-shell-guards). Custom guards have no `mode`.

### `[hooks.checks.after_edit]` and `[hooks.checks.on_stop]`

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

### Runtime support

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

## Sessions

Sessions coordinate agents working in one repository and its worktrees. State
lives in one directory shared by every checkout of the repository.

| `[sessions]` key | Type   | Default                                                     | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------------- | ------ | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `store`          | string | `"files"`                                                   | The only store.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `state_dir`      | path   | `$XDG_STATE_HOME/pmcp/projects/<id>` (`~/.local/state/...`) | `<id>` is the first 16 hex digits of the sha256 of the git common directory. `~`, `~/` and `$HOME/` expand to the home directory and a relative path is relative to the main checkout: the directory holding `pmcp.toml`, taken in the worktree of the git common directory, so the main checkout and every linked desk share one state. Outside git it is relative to the directory holding `pmcp.toml`. The hooks, the mod and the git commands resolve it the same way; so does `[git.mainline.gate] tree`. |

`store` and `state_dir` alone enable nothing; each feature has its own table:

| Table                      | Keys                                                                                                                                                                                                            | Effect                                                                                                                                          |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `[sessions.registry]`      | `liveness` (`"pid_heartbeat"`, the only value), `stale_minutes` (default `30`)                                                                                                                                  | Records each session with its process and heartbeat; `pmcp sessions status` lists them.                                                         |
| `[sessions.pause]`         | `mode` (`deny` default, `ask`, `warn`, `off`), `refuses` (`"mutating"`), `scripts` (regular expressions, default `[]`: a `node` script matching one also counts as mutating, e.g. your own land or sync script) | While `pmcp sessions pause` is in effect, edits and mutating commands are refused for every session but the one that paused; reading continues. |
| `[sessions.broadcast]`     | `keep` (default `10`), `deliver_on` (default `["session_start", "prompt", "before_tool"]`; also `after_tool`, `stop`)                                                                                           | Delivers `pmcp sessions broadcast` text once to each session, as context on the listed events.                                                  |
| `[sessions.leases.<name>]` | `path` (string, shown in the message and used by git delivery), `blocks` (required list of argv prefixes)                                                                                                       | While another session holds lease `<name>`, commands starting with a listed prefix are denied until it lands.                                   |
| `[sessions.roles.<name>]`  | `agent_type` (default `<name>`, also matches `plugin:<name>`), `allow_edits` (default `false`), `allow_commands` (list of argv prefixes, default `[]`)                                                          | A subagent of that type may edit only if allowed and run only the listed commands. Claude only.                                                 |

These tables have no `mode`, except pause. Without `[sessions.registry]` no
session is recorded, and `[ui.claude]` refuses to project.

### `[sessions.mailbox]`

Addressed messages between sessions and the operator. A missing table leaves
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
`role:<name>` (a `[sessions.roles]` name or the agent type), or `desk:<path>`
(the desk's path, or its directory name). A message to `all` reaches the
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
pmcp sessions send --to alias:reviewer --to role:lander --subject deploy --once "Hold the deploy until 14:00"
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
are still written, so `pmcp sessions status`, the fleet snapshot and the
Claude status band read broadcasts as before. `unbroadcast` withdraws those
messages too.

## Git workflow

| `[git]` key | Type                  | Default                                    | Meaning                                                                                                |
| ----------- | --------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `enabled`   | `"auto"`, true, false | `"auto"`                                   | `auto` turns the git features on when the project is a git checkout; `false` turns all of them off.    |
| `remote`    | string                | `origin` if present, else the first remote |                                                                                                        |
| `mainline`  | string or table       | the remote's HEAD branch, else `main`      | A string names the branch; a table (`[git.mainline]` with `branch`) also holds gate, deliver and sync. |

`[git.shared_checkout]` warns a session working in the main checkout of a
repository that also has worktrees (desks), tracks the files it edits there,
and names unlanded leftovers, because they block syncing the shared main for
everyone. Keys: `enabled` (`"auto"` default, following `[git] enabled`, or a
boolean), `warn_on_session`, `track_edits`, `warn_claimants` (booleans, default
`true`). It is on in any git checkout without a table, once something else
enables the hook bundle.

`[git.worktrees]` configures desks for `pmcp git worktree`:

| Key              | Type      | Default                    |
| ---------------- | --------- | -------------------------- |
| `root`           | string    | `".claude/worktrees"`      |
| `branch_prefix`  | string    | `"worktree-"`              |
| `alias_pattern`  | regex     | `"^[a-z][a-z0-9-]{1,30}$"` |
| `bootstrap`      | argv list | none                       |
| `link_from_main` | list      | `[]`                       |

`[git.worktrees.sync]` (opt-in) keeps each desk on the mainline when moving it
loses nothing: `on_session_start` (`"fetch_and_move"` default, `"move"`,
`"off"`), `between_prompts` (`"move_if_light"` default, `"off"`: move only when
no install is needed), `install_after_move` (`"off"` default, `"background"`,
`"foreground"`) and `notice_paths` (paths whose change is announced to the
session). Installs never block a session.

`[git.mainline.gate]`: `command` (argv; no gate when missing), `tree` (the
gate's worktree, default `<state dir>/gate/tree`; a relative path is relative to
the main checkout, like `state_dir`), `lock_wait_seconds`
(default `5400`).

`[git.mainline.deliver]` enables `pmcp git deliver`, which replays commits onto
the fetched mainline, runs the gate, and pushes one delivery at a time:
`attempts` (default `3`), `refuse_direct_push` (default `true`: a hook refuses
`git push` from any checkout of this repository, so the mainline moves only
through delivery), `during_pause` (`"refuse"` default or `"allow"`),
`lease_wait_seconds` (default `3600`) and `notify` (argv run after a
delivery).

`[git.mainline.sync]` enables `pmcp git sync`, which moves the main checkout to
the mainline: `install` (argv), `install_when_changed` (paths; when no
`[sessions.leases]` are declared, these become an implicit `lockfile` lease),
`keep_identical_files` and `refuse_with_unlanded` (booleans, default `true`).

`[git.submodules]`: `follow = "clean_pins"` (the default when the table is
present) moves submodules to the pinned commit when they are clean; `"off"`
leaves them. Without the table submodules are not followed.

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
switches hook logging on or off. Read the logs with `pmcp logs`.

## Claude session panes

`[ui.claude]` installs the session panes into Claude Code: `sessions_pane`,
`status_band`, `commands` and `hold_foreign_edits`, all booleans defaulting to
`true`. `hold_foreign_edits` asks before editing a file another live session
edited. It needs `[sessions.registry]`, and is written only when `claude` is
in `[targets] tools`. Without the table nothing is installed. `pmcp doctor`
shows the projected switches, or a failure until `pmcp project` writes them; it
cannot tell whether a running Claude Code loaded the mod.

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

[hooks.guards.git.push_without_verify]

[hooks.guards.git.forced_branch_move]

[hooks.guards.git.stage_all]

[hooks.guards.git.gate_bypass_env]
names = ["ALLOW_DIRECT_PUSH", "GATE_LOCK_HELD"]

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

[sessions.roles.lander]
allow_commands = [["pmcp", "git", "deliver"], ["git", "log"], ["git", "status"]]

[git]
remote = "origin"

[git.mainline]
branch = "main"

[git.mainline.gate]
command = ["npm", "test"]

[git.mainline.deliver]

[git.mainline.sync]
install = ["npm", "ci"]
install_when_changed = ["package-lock.json"]

[git.worktrees]
bootstrap = ["node", "scripts/worktree-bootstrap.mjs"]
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

## Operator shell guards

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

## Operator edit guards

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
