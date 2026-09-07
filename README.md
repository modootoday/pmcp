# pmcp

Find and use package skills without loading every document into your agent's context.
`pmcp` reads installed `SKILL.md` files and exposes three MCP tools: `skill_catalog`,
`skill_find`, and `skill_call`.

## Install

```sh
npm install --save-dev @modootoday/pmcp
```

Register it with an MCP host:

```json
{
  "mcpServers": {
    "pmcp": { "command": "npx", "args": ["-y", "@modootoday/pmcp"] }
  }
}
```

For Claude Code:

```sh
claude mcp add pmcp -- npx -y @modootoday/pmcp
```

## Commands

```sh
pmcp list
pmcp available
pmcp install --all --dry-run
pmcp install <skill-package> --yes
pmcp sync --dry-run
pmcp login
pmcp whoami
pmcp logout
```

`available` matches the provided catalog against actual installed dependency
versions locally. `install` and `sync` use npm or Bun, pin exact versions, and
require confirmation before changing the project's manifest and lockfile.
`--dry-run` does not install packages. `--catalog <file>` uses a saved catalog
response instead of fetching one. Registry access is handled by your package
manager; an OAuth login is not an npm registry token.

Run `pmcp --help` or `pmcp <command> --help` for options. With no command,
`pmcp` serves MCP on stdio. Use `--root <node_modules>` to select a local tree
and repeat `--scope <prefix>` to restrict local package discovery.

## Package skills

Skills are discovered by filename, including `skills/`, `.agent/skills/`,
`.claude/skills/`, `.gemini/skills/`, `.codex/skills/`, and `lib/skill/` layouts
within the discovery depth. A skill needs a frontmatter `description` for search.

`skill_find` accepts a problem description and returns matching skills.
`skill_call` opens the selected document. Local MCP reading requires no login.

## Runtime and licence

Node.js 22 or later, or Bun 1.3 or later. Default ranking is lexical. The optional
`index` command requires a separately installed encoder; it is not part of the
default installation.

Elastic License 2.0. See `LICENSE` and `NOTICE` for terms and dependency notices.
Documentation: <https://pmcp.build>.
