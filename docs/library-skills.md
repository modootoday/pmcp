# Library skills

[Back to the overview](../README.md)

Free instructions for public libraries, one plugin per library major line. Install them as
native plugins from the public marketplace, as npm skill packages with `pmcp install`, or, for
Python, Rust and Go, copy them into a local collection. How pmcp finds and serves skills in
general is in the [skills reference](skills.md).

## How they are matched and verified

Each npm library skill is for one package and major line, not for a kind of task: its
description names the package and major (most read "Use <package> <major> to ..."). In `docs/catalog.json`, every entry's
`targets` name the `packageName` and the version `range` it applies to, and
`pmcp available` and `pmcp install` match that against the version your project has
installed. Every entry also carries the evidence it was checked against: `evidence.examplesExecuted`
(the examples that ran), `evidence.verifiedOn` (the date) and, per target,
`verifiedVersions` (the exact versions they ran on). A native plugin install does not match
versions for you, so choose the major you use.

## Native plugins from the public marketplace

The public repository's canonical sources are standard Agent Skills folders:
`plugins/<product-major>/skills/<skill-name>/SKILL.md`. Each supported library
major is a separate selectable plugin. The PMCP bridge has its own `pmcp` plugin.
The website's `docs/skills/` files are generated downloads from those sources,
with immutable archives.

| Tool            | Native distribution                                                  |
| --------------- | -------------------------------------------------------------------- |
| Claude Code     | `.claude-plugin/marketplace.json` and plugin manifests               |
| Codex           | `.agents/plugins/marketplace.json` and portable `plugin.json`        |
| Grok Build      | Claude-compatible marketplace and plugin manifests                   |
| Gemini CLI      | `gemini-extension.json`; selected CLI exports are extensions         |
| Antigravity CLI | Selected CLI export with its own `plugin.json` and `mcp_config.json` |

The native marketplace commands are in the [README](../README.md#free-library-skills-as-native-plugins).
Gemini and Antigravity need their own package formats for selected library plugins;
do not assume that identically named manifest files accept the same schema.
`pmcp marketplace export <plugin> --runtime <tool> --output <new-directory>`
materializes a selected package without altering native
settings or installing it. Use the native manager to review and install that folder.
Existing export destinations are preserved.

The built-in catalog is available without remote fetching.
`--no-builtin` or `[catalog] builtin = false` opts out; library APIs continue to
read explicitly supplied catalog roots. `--marketplace <directory>` reads installed
Claude, Codex and Grok local descriptors, rejects path escapes and does not fetch
remote plugin sources. Add a remote marketplace with its native manager first.

## npm skill packages

Public npm skill installation uses the bundled catalog, a matching installed
dependency version and immutable free archive URLs. It verifies archive integrity,
content-only metadata, instruction digests and installed file bytes. npm, Bun or pnpm
changes the project and lockfile only after confirmation, with scripts disabled.
`--provider hosted` remains a separate service path with its own access policy.
Native plugin installation does not automatically version-match dependencies:
select the appropriate major yourself. Non-npm library instructions remain manual.

## Python, Rust and Go libraries

These three library-major skills provide free public instructions for Python,
Rust and Go libraries. Select them yourself and copy them into a local collection
you choose. No PMCP login, subscription or registry account is required to read
the files or load that collection.

| Ecosystem  | Library                    | Selected version                | Instructions                                                             |
| ---------- | -------------------------- | ------------------------------- | ------------------------------------------------------------------------ |
| PyPI       | `pydantic` 2               | `2.13.4`                        | [Pydantic SKILL.md](https://pmcp.build/skills/pydantic/2/SKILL.md)       |
| crates.io  | `serde_json` 1             | `1.0.149`, with Serde `1.0.228` | [serde_json SKILL.md](https://pmcp.build/skills/serde-json/1/SKILL.md)   |
| Go modules | `github.com/google/uuid` 1 | `v1.6.0`                        | [Google UUID SKILL.md](https://pmcp.build/skills/google-uuid/1/SKILL.md) |

Selected versions identify each skill's scope. They are not a statement that
every project, feature or AI runtime has been verified. Each SKILL.md contains
its own supported task boundaries and links to primary documentation and
licenses. Keep those sources when copying or adapting the instructions.

### Choose a collection and copy only the skills you need

Place each downloaded file under its frontmatter name:

```text
chosen-collection/
  skills/
    pydantic/
      SKILL.md
    serde-json/
      SKILL.md
    google-uuid/
      SKILL.md
```

Include only your selected files; all three are not required locally. The
collection may be a plain directory without a package.json. Keep SKILL.md
frontmatter, source links and any accompanying reference files intact. The
collection's directory name is a local discovery label, not a registry package
identity.

### Register the collection explicitly

For a direct CLI invocation:

```bash
pmcp serve --package /absolute/path/to/chosen-collection
```

Or merge the chosen path into the existing project's pmcp.toml:

```toml
[catalog]
packages = ["./chosen-collection"]
```

Preserve other catalog entries rather than replacing them with this example.
Project-relative paths resolve from the configuration's directory. The
existing `skill_catalog`, `skill_find` and `skill_call` tools can then discover
and read the selected local instructions. Leave folder trust and tool approval
to the native AI runtime.

### Understand the manual boundary

PMCP does not automatically detect these libraries from PyPI, Cargo or Go
dependencies. They are separate from the managed npm skill catalog and are
not installed through `pmcp available` or `pmcp install`. Serving a local
collection does not install a library, download a compiler or run its examples.

Loading an instruction file also does not establish model execution evidence.
Check the project's installed library major, lockfile and environment before
applying guidance, and run the appropriate project checks after code changes.
This explicit workflow supplements the package skill discovery described in
the [skills reference](skills.md).
