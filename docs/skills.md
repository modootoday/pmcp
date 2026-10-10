# Skills and MCP reference

[Back to the overview](../README.md)

## Package skills

Skills are discovered by filename, including `skills/`, `.agents/skills/`,
`.agent/skills/`, `.claude/skills/`, `.gemini/skills/`, `.codex/skills/`, and
`lib/skill/` layouts
within the discovery depth. A skill needs a frontmatter `description` for search.

`skill_find` accepts a problem description and returns matching skills.
`skill_call` opens the selected document and lists the reference, script and asset
files it carries, as text and as resource links. Local MCP reading requires no login.

Files keep their type, as the Agent Skills layout (`references/`, `scripts/`, `assets/`)
expects: `skill_read` returns text as text, images and audio as image and audio content,
and other binary files as an embedded resource with its media type; a file whose extension
names text but whose bytes are not UTF-8 goes out as a blob, so its sha256 stays exact.
Scripts are returned, never run: running them is the host's job, from a local copy of the
skill. `skill_bundle` lists every file of a skill as resource links that `resources/read`
returns, so a host can write the skill into a local skills directory without the bytes
passing through the model.

`skill_catalog`, `skill_find`, `skill_describe` and `skill_bundle` declare an
`outputSchema` and return `structuredContent` alongside the same JSON as text.
Frontmatter is read as YAML (folded and block descriptions, a BOM and CRLF are fine), and
`metadata` is read for every skill. Loading is lenient, as the client guide asks; what
breaks the specification is reported, and `pmcp validate [<skill-dir>...]` checks given
directories or every skill the catalog reaches (name rules and length, description and
compatibility length, field types, name matching the directory, duplicate names).

`metadata` keeps strings, string lists and maps of those one level down; `skill_describe`
reports a map as dotted keys, so `requires: {mcp, gpu-gb}` arrives as `requires.mcp` and
`requires.gpu-gb`. Deeper nesting is dropped.

Output schemas accept additional properties, so a field added later does not break a
client that cached an earlier tool list. An answer to a call without the newer inputs keeps
the earlier shape.

Since 0.9.0 a skill can list `metadata.verified-runtimes`, a list drawn from `claude-code`,
`codex-cli`, `gemini-cli`, `grok-cli` and `antigravity`, meaning its effect was verified on
that runtime. `skill_find` and `skill_catalog` accept `runtime` and `verifiedOnly`; when either
is given, items carry `verifiedRuntimes` (omitted when empty). `runtime` never removes a skill: it marks
each item `verified` and lists verified ones first (within a package group in
`skill_catalog`). `verifiedOnly` drops the rest, keeping those verified on `runtime`, or on
any runtime when none is given. Without `runtime` the answer is ordered exactly as before.
A server can opt in with `rankByClientRuntime: true`: then, when `runtime` is not passed and
the MCP client's name is recognised (`claude-code`, `codex`, `gemini`, `grok`,
`antigravity`), that runtime is used for the ordering only, never for filtering.
`skill_find` then answers with `runtime`, the one the ordering used, or `null`.

`pmcp serve --prompts` also offers one prompt per skill, for hosts that turn prompts into
commands; the prompt's text is the skill body and its file list, with an optional `task`.

Marketplace plugins also carry commands, agents, hooks and MCP servers.
Commands are listed as skills. The others are listed under their own kind and
are left out of `skill_catalog` and `skill_find` unless `kind` asks for them
(`agent`, `hook`, `mcp`, or `any`); `skill_describe`, `skill_read` and
`skill_call` work on every kind.

## Public native marketplace

The public repository's canonical sources are standard Agent Skills folders:
`plugins/<product-major>/skills/<skill-name>/SKILL.md`. Each supported library
major is a separate selectable plugin. The PMCP bridge has its own `pmcp` plugin.
The website's `docs/skills/` files are generated downloads from those sources;
existing URLs and immutable archive bytes remain available.

| Tool            | Native distribution                                                  |
| --------------- | -------------------------------------------------------------------- |
| Claude Code     | `.claude-plugin/marketplace.json` and plugin manifests               |
| Codex           | `.agents/plugins/marketplace.json` and portable `plugin.json`        |
| Grok Build      | Claude-compatible marketplace and plugin manifests                   |
| Gemini CLI      | `gemini-extension.json`; selected CLI exports are extensions         |
| Antigravity CLI | Selected CLI export with its own `plugin.json` and `mcp_config.json` |

For native marketplace commands, follow the [README](../README.md).
Gemini and Antigravity need their own package formats for selected library plugins;
do not assume that identically named manifest files accept the same schema.
After the next npm release, `pmcp marketplace export <plugin> --runtime <tool>
--output <new-directory>` materializes a selected package without altering native
settings or installing it. Use the native manager to review and install that folder.
Existing export destinations are preserved.

The built-in catalog on repository main is available without remote fetching.
`--no-builtin` or `[catalog] builtin = false` opts out; library APIs continue to
read explicitly supplied catalog roots. `--marketplace <directory>` reads installed
Claude, Codex and Grok local descriptors, rejects path escapes and does not fetch
remote plugin sources. Add a remote marketplace with its native manager first.

Public npm skill installation uses the bundled catalog, a matching installed
dependency version and immutable free archive URLs. It verifies archive integrity,
content-only metadata, instruction digests and installed file bytes. npm or Bun
changes the project and lockfile only after confirmation, with scripts disabled.
`--provider hosted` remains a separate service path with its own access policy.
Native plugin installation does not automatically version-match dependencies:
select the appropriate major yourself. Non-npm library instructions remain manual.

## Manually selected Python, Rust and Go library skills

Public Pydantic, serde_json and Google UUID instructions are free to read and
copy into a local collection. Register that collection explicitly; these pilots
are not automatically matched from PyPI, Cargo or Go dependencies. Follow the
[manual library skills guide](manual-library-skills.md) for download paths and
the existing CLI configuration workflow.

## MCP Skills extension

The server also declares `io.modelcontextprotocol/skills` (SEP-2640): it
answers `skills/list` and `skills/get` (both with `ttlMs` and `cacheScope`), with
a sha256 digest and size per file. A skill qualifies when its frontmatter passes the
Agent Skills specification and its `name` matches its directory, and it stays within
512 files and 16 MiB; the rest remain reachable through the tools.

Every file of every skill the caller may see is a `skill://pmcp/<package>/<name>/<file>`
resource: `resources/list` lists each skill's `SKILL.md`, `resources/read` returns any file
(text, or a blob with its media type), and the template completes skill names and paths.
List-change notifications and subscriptions are not offered: they need a session, and the
HTTP handler is stateless.
