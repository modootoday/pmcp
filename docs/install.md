# Installation

[Back to the overview](../README.md)

Two of these write the configuration for you. The rest are a line of JSON or a command, depending on where your agent keeps its servers.

## One click

[Add to Cursor](cursor://anysphere.cursor-deeplink/mcp/install?name=pmcp&config=eyJ0eXBlIjoic3RkaW8iLCJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBtb2Rvb3RvZGF5L3BtY3AiXX0=) [Add to VS Code](vscode://mcp/install?name=pmcp&config=%7B%22type%22%3A%22stdio%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40modootoday%2Fpmcp%22%5D%7D)

Those two links carry the whole server definition in their payload, so the editor opens with the form already filled in.

## As a dev dependency

```sh
npm install --save-dev @modootoday/pmcp
```

Installing it is optional. Every configuration below runs it through `npx -y @modootoday/pmcp`, which works with nothing installed; adding it to the project pins the version your team gets.

## Native marketplace

The `pmcp` plugin adds the MCP bridge to Claude Code, Codex and Grok, and Gemini installs it
with `gemini extensions install https://github.com/modootoday/pmcp`. Library instructions
install the same way, one plugin per library major: see [Library skills](library-skills.md).

## A host that spawns servers over stdio

```json
{
  "mcpServers": {
    "pmcp": { "command": "npx", "args": ["-y", "@modootoday/pmcp"] }
  }
}
```

That is the shape most hosts read. The file it goes in differs by host, and the two commands below write it for you.

## Claude Code

```sh
claude mcp add pmcp -- npx -y @modootoday/pmcp
```

## VS Code, from a script

```sh
code --add-mcp '{"name":"pmcp","command":"npx","args":["-y","@modootoday/pmcp"]}'
```

The same thing the badge does, for setting up a workstation rather than clicking through one.

## Options the server takes

- `--root <dir>`: a `node_modules` directory to walk, instead of discovering upwards from
  the working directory; repeatable.
- `--scope <prefix>`: only packages whose names start with this; repeatable, and takes a
  comma-separated list.

Both go in the `args` array beside `pmcp`. A host that passes them with no command still gets the server, because a bare spawn is what the protocol expects.

## What arrives

- Node 22 or later, or Bun 1.3 or later.
- Runtime dependencies: `@modelcontextprotocol/server`, `zod`, `semver`, `smol-toml` and `yaml`. Their MIT, ISC and BSD-3-Clause notices are listed in the package's `NOTICE`.
- No postinstall hook, and nothing downloaded at install time. Semantic ranking needs an optional peer you install yourself.

## Optional native workspace

Share MCP settings through the [pmcp.toml reference](project-configuration.md). The [native harness](terminal-harness.md) and [terminal workspace](terminal-workspace.md) run on Linux (glibc 2.35 or later, with a working user systemd manager) or macOS, with Node.js 22; npm installs pmcp-pty and pmcp-tui with pmcp. Run `pmcp tui doctor` to check the host. Provider credentials stay with the native tools.

**Check it before you trust it.** `npx -y @modootoday/pmcp list` prints what the server would see from this directory. The CLI includes the free catalog; `--no-builtin` restricts discovery to your own roots. [Getting started](getting-started.md) is the five-minute version.
