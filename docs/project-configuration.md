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
the same meaning; an unknown key is an error. A flag replaces the file's list
of its kind. `--config <file>` names another file and `--no-config` ignores it.

## Native files for each agent tool

`pmcp project` writes what Claude Code, Codex, Gemini CLI, Grok Build and
Antigravity read natively, from cross-tool sources under `.agents/`
(`skills/<name>/SKILL.md`, `agents/<name>/agent.md`, `rules/*.md`) and the rest
of `pmcp.toml`:

```toml
[targets]
tools = ["claude", "codex", "gemini", "grok", "antigravity"]

[skills.deploy]
invocation = "user"          # the person starts it; the model is not offered it

[agents.reviewer.claude]
tools = "Read, Grep"         # fields one tool reads stay out of agent.md

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

Rules go to `.claude/rules/<dir>/`, never the top level, because Grok Build
loads top-level `.claude/rules/*.md` in every session regardless of `paths:`.
A server that names `${PROJECT_ROOT}` is launched through `sh`, which finds
`pmcp.toml` at spawn time, so the generated files hold no machine's path.
`pmcp.lock` records what was written; a file pmcp did not write is never
overwritten. `doctor` calls no model: it reads `claude mcp list`,
`codex mcp list`, `gemini skills list`, `gemini mcp list` and
`grok inspect --json`, and skips a tool that is not installed.

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
token without writing its value. Each runtime retains its own OAuth session.
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

## Operator shell guards

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
