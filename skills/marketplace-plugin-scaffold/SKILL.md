---
name: marketplace-plugin-scaffold
description: Package skills, commands, subagents, hooks and MCP servers as a plugin in a plugin marketplace laid out the way pmcp's catalog reads it - marketplace.json with a tier, plugin.json, skills/, commands/, agents/, hooks/hooks.json and .mcp.json - and confirm every asset is listed with pmcp list and pmcp validate. Use when turning a folder of skills into a marketplace plugin, when a plugin's assets do not show up in a skill catalog, or when setting the tier of a marketplace. Not for writing a single skill's content or for hosting the catalog over HTTP.
metadata:
  tier: open
  level: L2
  domain: agent-workflow
  install: optional
  keywords: "plugin marketplace, marketplace.json, plugin.json, skill plugin, pmcp catalog, tier, commands, hooks, mcp.json"
  requires-bin: "pmcp"
  verified-runtimes: "claude-code"
---

# Scaffolding a marketplace plugin pmcp can read

pmcp reads a marketplace by its files, with no package.json involved. Anything outside the
places below is invisible to it, and an asset without a description is dropped with a
reason, not served.

## Layout

```
<marketplace>/
  .claude-plugin/marketplace.json
  plugins/<plugin>/
    .claude-plugin/plugin.json
    skills/<name>/SKILL.md
    commands/<name>.md
    agents/<name>.md            or agents/<name>/agent.md
    hooks/hooks.json
    .mcp.json
```

## marketplace.json

```json
{
  "name": "acme",
  "metadata": { "tier": "open" },
  "plugins": [
    { "name": "billing-skills", "source": "./plugins/billing-skills" }
  ]
}
```

- A plugin entry without `name` or `source`, or whose `source` directory does not exist, is
  skipped without a message. Check the count in `pmcp list`.
- The tier lives here, for the whole marketplace. There is no plugin-level tier.
- A skill, command or agent may repeat it as `metadata.tier` in its frontmatter. If that
  disagrees with the marketplace tier the asset is rejected, because a mislabelled tier is
  how a private asset leaks. Keep one tier per marketplace and split marketplaces by tier.

## plugin.json

`description` is what a hook entry and each MCP server entry are described with. `hooks` may
name a different hooks file (a string path); otherwise `hooks/hooks.json` is read.

## What each place becomes

| Place                                        | Catalog entry                                                                             | Name in the catalog                    |
| -------------------------------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------- |
| `skills/<name>/SKILL.md`                     | a skill; its folder is what describe and read may open                                    | `<marketplace>/<plugin>/<name>`        |
| `commands/<name>.md`                         | a one-file skill; only that file is readable                                              | `<marketplace>/<plugin>/<name>`        |
| `agents/<name>.md`, `agents/<name>/agent.md` | kind `agent`                                                                              | `<marketplace>/<plugin>/agents/<name>` |
| `hooks/hooks.json`                           | one kind `hook` entry for the plugin; needs a `description` in the file or in plugin.json | `<marketplace>/<plugin>/hooks`         |
| `.mcp.json`                                  | one kind `mcp` entry per key of `mcpServers`                                              | `<marketplace>/<plugin>/mcp/<server>`  |

Skills and commands appear in `skill_catalog` and `skill_find`. Agents, hooks and MCP
servers are left out unless the caller asks for that `kind` (`agent`, `hook`, `mcp` or
`any`). A command is listed like any skill; nothing marks it as started by the user only.
The frontmatter `name` sets the slug; without one the file or folder name is used. Keep
them equal: the Agent Skills specification requires a skill's name to match its directory.

## Check

```sh
pmcp list --marketplace <marketplace> --no-config      # every entry, with its tier
pmcp validate --marketplace <marketplace> --no-config  # rejections and specification errors
```

`validate` prints why each asset was left out (`no description`, `metadata.tier ... in a
... marketplace`, `.mcp.json has no mcpServers object`, `hooks.json is not a JSON object`).
Compare the `list` count with the files you created; a missing plugin is usually a wrong
`source`.

## Report

The tree, marketplace.json and plugin.json, the `pmcp list` count per kind against the files
created, and the `pmcp validate` output.
