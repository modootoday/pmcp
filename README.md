# pmcp

Use the skills your packages already ship, and keep your AI tools' project
configuration in one place.

pmcp discovers `SKILL.md` documents in installed packages, workspace packages
and plugin marketplaces. Your AI tool can search the catalog and open a skill
when it needs one, without loading the entire catalog into each conversation.

Claude Code, Codex, Gemini CLI, Grok Build and Antigravity keep their native
model calls, account login and permission controls. pmcp supplies skills,
projects shared configuration into their native formats, and optionally provides
a local mailbox for exchanging messages.

| What you want to do                                           | Use                            |
| ------------------------------------------------------------- | ------------------------------ |
| Find and read package skills from your AI tool                | The MCP skill catalog          |
| Install selected free library instructions as native plugins  | The PMCP public marketplace    |
| Keep several tools' MCP servers and project assets consistent | `pmcp.toml` and `pmcp project` |
| Check what an installed tool loads                            | `pmcp doctor`                  |
| Search across languages using local embeddings                | `pmcp models` and `pmcp index` |
| Exchange messages between authorized local actors             | The optional mailbox           |
| Supervise native main and worker terminals locally            | `pmcp harness`                 |
| View a native main, worker dock and coordination panel        | `pmcp tui`                     |
| Serve a catalog to your own application                       | The HTTP library               |

## Get started

Requires Node.js 22 or later, or Bun 1.3 or later.

Install pmcp in your project:

```sh
npm install --save-dev @modootoday/pmcp
```

For Claude Code, register the MCP server from the project directory:

```sh
claude mcp add pmcp -- npx @modootoday/pmcp serve
```

Other MCP hosts can use a stdio entry:

```json
{
  "mcpServers": {
    "pmcp": {
      "command": "npx",
      "args": ["@modootoday/pmcp", "serve"]
    }
  }
}
```

Restart or reconnect your tool's MCP connection after changing its configuration.
Ask your tool to find a skill relevant to your task and open the result.
Local skill discovery and reading require no pmcp login.

## Native plugins and free library skills

The public GitHub repository is also a marketplace. Choose individual library
major lines; adding the marketplace does not activate its entire catalog.
For example, install the TypeScript 5 instructions with your native manager:

```sh
claude plugin marketplace add modootoday/pmcp
claude plugin install typescript-5@pmcp
claude plugin install pmcp@pmcp
```

```sh
codex plugin marketplace add modootoday/pmcp
codex plugin add typescript-5@pmcp
codex plugin add pmcp@pmcp
```

Grok supports the same marketplace with `grok plugin marketplace add modootoday/pmcp`
and `grok plugin install typescript-5@pmcp`. The separate `pmcp` plugin adds the
PMCP MCP bridge. Gemini can install that bridge with
`gemini extensions install https://github.com/modootoday/pmcp`.
Native confirmation and runtime provider login remain with each tool.

Since 0.14.0, the CLI bundles the free catalog and can export one
plugin for Claude, Codex, Gemini, Grok or Antigravity:

```sh
pmcp marketplace list
pmcp marketplace export typescript-5 --runtime agy --output ./typescript-plugin
agy plugin install ./typescript-plugin
```

The marketplace export command, bundled catalog and anonymous `install` provider
are included in npm 0.14.0. GitHub native marketplace installation and the
website's free archives are available independently. See the [skills guide](docs/skills.md) for layouts,
runtime-specific formats and version selection.

To include your workspace's own skills, create `pmcp.toml` at the project root:

```toml
[catalog]
workspaces = ["."]
```

Run `npx @modootoday/pmcp list` to see the local catalog. Paths in the configuration resolve
relative to `pmcp.toml`; pmcp searches for this file above the working directory.

## Share configuration across your tools

Declare your tools and MCP servers in the same `pmcp.toml`:

```toml
[targets]
tools = ["claude", "codex", "gemini", "grok", "antigravity"]

[mcp.docs]
url = "https://example.com/mcp"
```

Replace the example URL with your server, then run:

```sh
npx @modootoday/pmcp project
npx @modootoday/pmcp project --check
npx @modootoday/pmcp doctor
```

`project` generates native files for the selected tools and records its ownership
in `pmcp.lock`. It preserves unrelated settings and refuses conflicting unmanaged
entries. `--check` reports drift without writing files. Each runtime retains its
own OAuth session.

The [configuration guide](docs/project-configuration.md) covers importing
existing servers, environment references, shared skills and rules, shell guards
and memory metadata.

## Manage native terminals

PMCP 0.13.0 or later can show a native main runtime, its worker terminals and a
coordination panel in one terminal workspace. The optional harness and TUI need
Linux, tmux, util-linux flock, Node.js 22 or later and a working user systemd
manager. Provider login, folder trust and tool approvals remain native.

```sh
npx @modootoday/pmcp --version
npx @modootoday/pmcp harness doctor inspect
npx @modootoday/pmcp tui doctor
```

On a supported interactive host, open the workspace with:

```sh
pmcp
```

The first launch shows the selected native main runtime and asks before starting
it. No group or view JSON is required. Later launches reconnect to the workspace
created for this project. Native login and folder trust stay with the runtime.
Use `pmcp tui --runtime codex-cli` to choose the main, or set an optional default:

```toml
[tui]
runtime = "codex-cli"
```

Once the workspace is open, add a worker with
`pmcp tui start-worker --runtime gemini-cli`. The existing group keeps its
runtime grants and resource bounds. Use `pmcp tui recovery` to inspect a saved
workspace and obtain explicit next commands after an interrupted start. Inspection
does not restart a runtime or replay input.

`pmcp tui plan` previews the settings without starting anything. The
[terminal workspace guide](docs/terminal-workspace.md) covers defaults, custom
configuration and advanced controls. The [native terminal guide](docs/terminal-harness.md)
explains explicit group and session operations.
Views start read only; acquiring control and stopping a runtime are explicit
actions. This optional CLI feature does not add execution tools to the MCP server.

## Everyday commands

Run these with `npx @modootoday/pmcp`, or with `pmcp` when it is on your PATH:

```sh
pmcp list
pmcp available
pmcp install --all --dry-run
pmcp install <skill-package> --yes
pmcp sync --dry-run
pmcp validate
```

`available` checks catalog packages against your installed dependencies.
`install` and `sync` use npm, Bun or pnpm and require confirmation
before changing your manifest and lockfile. `--dry-run` previews the work.
Use `--catalog <file>` to read a saved catalog response.

These commands use the bundled public catalog by default.
Public installation downloads verified content-only archives without PMCP login.
Use `--provider hosted` or an explicit `--api` for a separately hosted service.
CLI discovery includes the free marketplace unless `--no-builtin` is passed or
`[catalog] builtin = false` is configured. Library APIs keep explicit catalog selection.

`pmcp login`, `whoami` and `logout` manage optional hosted-service login.
skills.modoo.today is a separate service built on PMCP. Your runtime's provider
login remains with that runtime.

Run `pmcp --help` or `pmcp <command> --help` for options.
With no command, a supported interactive terminal opens the workspace. Piped
launches retain MCP stdio; `pmcp serve` selects MCP explicitly. Unsupported
interactive hosts show help and prerequisite guidance.

## Compatibility

| Surface                                | Current qualification                                                                                                                     |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| CLI and MCP on Linux amd64             | Published 0.15.0 passed clean Docker installation with npm on Debian/Alpine and Bun/pnpm on Debian; 60 installation and failure contracts |
| Optional terminal workspace            | Linux PTY/tmux checks and bounded native Codex, Gemini, Grok and agy main/worker acceptance; Claude remains deferred                      |
| Public skill installation              | npm, Bun and pnpm 10.17.1; confirmation required, scripts disabled                                                                        |
| Native plugin export                   | Claude, Codex, Gemini, Grok and agy formats; export does not install or activate a vendor plugin                                          |
| pnpm workspace installation            | Selects the member, preserves root dependencies and updates the shared lockfile                                                           |
| Yarn skill installation                | Refused without changing project files; Yarn PnP is not supported                                                                         |
| macOS, Windows and other architectures | Not qualified by the Linux Docker tests                                                                                                   |

Provider authentication, native children and vendor behavior have separate
qualification scopes. An installed executable or exported manifest is not proof
that every native feature works. Public package CI checks actual packed-archive
installation, CLI startup, MCP and SQLite before publication; isolated projects
on a host are distinct from Docker and OS qualification.

## Guides

| Guide                                                  | Contents                                                      |
| ------------------------------------------------------ | ------------------------------------------------------------- |
| [Project configuration](docs/project-configuration.md) | Catalog sources, native files, MCP import, guards and doctor  |
| [Skills and MCP reference](docs/skills.md)             | Skill documents, tools, resources, prompts and compatibility  |
| [Embedding models](docs/embeddings.md)                 | E5, EmbeddingGemma and custom local model selection           |
| [Local mailbox](docs/mailbox.md)                       | Actor credentials, messages, receipts and library integration |
| [HTTP hosting](docs/hosting.md)                        | Authentication, catalog access and request controls           |
| [Native terminal control](docs/terminal-harness.md)    | Owned sessions, explicit input, Docker profiles and recovery  |
| [Terminal workspace](docs/terminal-workspace.md)       | Main and worker panels, observation, control and failures     |
| [Security policy](SECURITY.md)                         | Reporting vulnerabilities                                     |

Semantic search is optional and requires `@huggingface/transformers` installed
separately. Lexical search works without downloading a model. The mailbox is
disabled until explicitly configured.

## Licence

pmcp is source available under [Elastic License 2.0](LICENSE).
See [NOTICE](NOTICE) for dependency notices and the embedding guide for model
licences. Website: [pmcp.build](https://pmcp.build).
