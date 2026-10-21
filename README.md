# pmcp

Use the skills your packages already ship, and keep your AI tools' project
configuration in one place.

pmcp is for repositories where people work with AI coding tools such as Claude
Code, Codex, Gemini CLI, Grok Build, Antigravity and opencode. It finds the
`SKILL.md` instructions your installed packages and marketplaces carry and lets
the tool load one when a task needs it, and it writes each tool's native
configuration from one `pmcp.toml`. The tools keep their own model calls,
logins and permission controls.

| What you want to do                                       | Use                            | Part     |
| --------------------------------------------------------- | ------------------------------ | -------- |
| Find and read the skills your packages ship               | the MCP skill catalog          | core     |
| Keep several tools' MCP servers, skills and rules in sync | `pmcp.toml` and `pmcp project` | core     |
| Check what each installed tool actually loads             | `pmcp doctor`                  | core     |
| Install free library instructions as native plugins       | the public marketplace         | optional |
| Stop agents from running risky commands                   | `[hooks]` guards               | optional |
| Run several agents in one repository without collisions   | `pmcp sessions`, `pmcp git`    | optional |
| Watch and steer native agent terminals (Linux, macOS)     | `pmcp tui`, `pmcp harness`     | optional |
| Give agents a browser or a desktop on a Linux server      | pmcp-browser, pmcp-desktop     | optional |
| Search skills in any language with a local model          | `pmcp models`, `pmcp index`    | optional |
| Serve a catalog or a mailbox from your own application    | the HTTP and mailbox libraries | optional |

## Install and connect

Requires Node.js 22 or later, or Bun 1.3 or later.

```sh
npm install --save-dev @modootoday/pmcp
claude mcp add pmcp -- npx @modootoday/pmcp serve
```

Other MCP hosts take a stdio entry:

```json
{
  "mcpServers": {
    "pmcp": { "command": "npx", "args": ["@modootoday/pmcp", "serve"] }
  }
}
```

Reconnect your tool's MCP servers after changing the configuration. Reading
local skills needs no pmcp account.

## Find your first skill

`pmcp list` shows what the server sees from here: one row per skill, with the
name and the description the search ranks.

```sh
npx @modootoday/pmcp list
```

Then ask your tool for help with a task in a full sentence. It calls
`skill_find`, which returns matching skill names without their bodies, and
`skill_call` for the one it picks. An empty catalog exits 1 and names the
directories it searched. [Getting started](docs/getting-started.md) walks
through the search and the options.

## Free library skills as native plugins

This repository is also a plugin marketplace. Install the library major lines
you use, one at a time:

```sh
claude plugin marketplace add modootoday/pmcp
claude plugin install typescript-5@pmcp
claude plugin install pmcp@pmcp
```

Codex (`codex plugin add`) and Grok (`grok plugin install`) take the same
names; Gemini installs the `pmcp` bridge with
`gemini extensions install https://github.com/modootoday/pmcp`, and
`pmcp marketplace export` writes a plugin for Antigravity. The
[skills reference](docs/skills.md) covers formats and versions; the
[library skills](docs/library-skills.md) page also covers Python, Rust and Go.

## Share configuration across your tools

```toml
[targets]
tools = ["claude", "codex", "gemini", "grok", "antigravity", "opencode"]

[mcp.docs]
url = "https://example.com/mcp"
```

```sh
npx @modootoday/pmcp init        # or write pmcp.toml yourself
npx @modootoday/pmcp project     # write each tool's native files
npx @modootoday/pmcp doctor      # ask each tool what it loads
```

`project` preserves settings it did not write, refuses conflicting ones and
records what it owns in `pmcp.lock`; `--check` reports drift without writing.
The [pmcp.toml reference](docs/project-configuration.md) covers every table.

## Guard commands and run several agents

`[hooks]` compiles guards (heredocs, `git add -A`, pushes that skip checks,
credential reads and more) into one hook bundle every targeted tool runs. With
sessions and the git workflow on, agents see each other, wait on shared files,
work in linked worktrees and deliver through one gate instead of pushing.
[Run several agents in one repository](docs/sessions.md) shows how.

## Watch and steer agent terminals

On Linux or macOS, `pmcp` opens a terminal workspace: a native main session, a
dock of workers and a coordination panel, read only until you take control.
npm installs the terminal host (pmcp-pty) and the workspace (pmcp-tui) with
pmcp. Login, folder trust and tool approvals stay in each tool. See the
[terminal workspace](docs/terminal-workspace.md) and
[native terminal control](docs/terminal-harness.md) guides.

## Commands

```sh
pmcp list            # skills the server sees
pmcp available       # catalog skill packages that match your dependencies
pmcp install --all --dry-run
pmcp validate        # check skill documents
pmcp status          # features, drift, live sessions
pmcp --help
```

The [command reference](docs/commands.md) lists every command, flag and exit
code.

## Documentation

| Page                                                         | For                                                         |
| ------------------------------------------------------------ | ----------------------------------------------------------- |
| [Getting started](docs/getting-started.md)                   | connecting a tool and finding skills                        |
| [pmcp.toml reference](docs/project-configuration.md)         | every `pmcp.toml` table with its keys and defaults          |
| [Hooks](docs/hooks.md)                                       | guards and checks, and which runtime supports what          |
| [Git workflow](docs/git-workflow.md)                         | linked worktrees, delivery and sync                         |
| [Browser and desktop](docs/browser-and-desktop.md)           | pmcp-browser and pmcp-desktop for agents                    |
| [Library skills](docs/library-skills.md)                     | free library instructions as plugins, npm packages or files |
| [Run several agents](docs/sessions.md)                       | sessions, messages, leases, worktrees and delivery          |
| [Skills and MCP reference](docs/skills.md)                   | skill layouts, tools, resources and the marketplace         |
| [Terminal workspace](docs/terminal-workspace.md)             | the `pmcp tui` workspace                                    |
| [Native terminal control](docs/terminal-harness.md)          | harness groups, control, recovery and `[host]`              |
| [Embedding models](docs/embeddings.md)                       | semantic search with a local model                          |
| [Local mailbox](docs/mailbox.md)                             | messages between actors with their own credentials          |
| [HTTP hosting](docs/hosting.md)                              | serving a catalog from your application                     |
| [Command reference](docs/commands.md)                        | commands, flags and exit codes                              |
| [Compatibility](docs/compatibility.md)                       | platforms, runtimes and qualification                       |
| [Glossary](docs/glossary.md)                                 | the terms these pages use                                   |
| [Release notes](https://github.com/modootoday/pmcp/releases) | what changed in each release                                |
| [Upgrading](docs/upgrading.md)                               | what to do when a release changes something you rely on     |
| [Known issues](docs/known-issues.md)                         | what the current release does not do yet                    |
| [Contributing](CONTRIBUTING.md), [Security](SECURITY.md)     | working on pmcp, reporting a vulnerability                  |

## Licence

pmcp is source available under [Elastic License 2.0](LICENSE). See
[NOTICE](NOTICE) for dependency notices and the embedding guide for model
licences. Website: [pmcp.build](https://pmcp.build).
