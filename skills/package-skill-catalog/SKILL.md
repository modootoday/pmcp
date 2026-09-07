---
name: package-skill-catalog
description: A project has grown past a hundred dependencies and nobody knows which of them shipped usage documentation an agent could read, so every question about an installed package is answered by opening its source; or an agent's context is being spent listing skills it never opens, and startup cost grows with every dependency added.
---

# pmcp

An MCP server that reads `SKILL.md` files out of `node_modules` and serves them
as three tools, so a session pays for the one skill it opens rather than for the
whole catalog.

## When to reach for it

Reach for this when the skills you want an agent to read arrive as npm packages
and leave when those packages are uninstalled. Discovery is derived from the
installed tree at request time, so the catalog is always true of the project and
there is no list for anyone to maintain.

Do not reach for this to hold a project's own skills. Those live in the
repository, they are not installed, and a host that already loads them does not
need a server in front of them. This exists for the skills you did not write.

## Install and wire

```sh
npm install --save-dev pmcp
```

For a host that spawns MCP servers over stdio:

```json
{
  "mcpServers": {
    "pmcp": { "command": "npx", "args": ["pmcp"] }
  }
}
```

Flags, all optional:

| Flag                   | Effect                                                              |
| ---------------------- | ------------------------------------------------------------------- |
| `--root=<dir>`         | Use this `node_modules` instead of discovering upwards. Repeatable. |
| `--scope=@acme,@other` | Only catalogue packages whose names start with one of these.        |

Embedded in a host you are writing yourself:

```ts
import { createSkillServer } from "pmcp";

const server = createSkillServer({
  roots: ["./node_modules"],
  scopes: ["@acme"],
});
```

## What the consuming repository must supply

Nothing, to read skills. To publish one, a package supplies a `SKILL.md` whose
YAML frontmatter carries `name` and `description`, at any of these paths:

```
<package>/skills/<slug>/SKILL.md
<package>/.agent/skills/<slug>/SKILL.md
<package>/.claude/skills/<slug>/SKILL.md
<package>/.gemini/skills/<slug>/SKILL.md
<package>/.codex/skills/<slug>/SKILL.md
```

The path is not what makes it a skill; the file is. Discovery walks each package
to a depth of three and treats any `SKILL.md` as a skill, skipping build output,
sources, nested installs and test corpora.

The `description` is the only text ranked, so write it as the symptom a reader
already has rather than as a list of what the package does. A skill with no
`description` is skipped rather than listed: ranking could never surface it, and
listing it would spend a session's tokens on an entry that cannot answer.

The package must also ship the file. A `SKILL.md` outside the manifest's `files`
array is not in the tarball and therefore not in anyone's `node_modules`.

## API

### Server

`createSkillServer(options)` returns a configured MCP server. `options.roots` is
required and holds `node_modules` directories, not package directories.
`options.scopes` filters by package-name prefix.

`SERVER_NAME` is the name the server reports at initialize.

### Catalog

`readCatalog({roots, scopes})` returns `SkillEntry[]`, sorted by name and
deduplicated: the first root wins, because a nested `node_modules` holds an older
copy of a package the outer root already resolved.

A `SkillEntry` carries `name` (`<package>/<slug>`), `package`, `slug`,
`description` and the absolute `path` of the file.

`readFrontmatter(source)` and `readBody(source)` split a `SKILL.md`. The
frontmatter reader is deliberately not a YAML parser: it reads flat scalars on
their own line and nothing nested, which is the honest limit rather than a
partial YAML.

`MAX_SKILL_DEPTH` and `SKIPPED_DIRS` are exported so a caller can see what
discovery will and will not walk.

### Tools on the wire

| Tool            | Argument                               | Returns                            |
| --------------- | -------------------------------------- | ---------------------------------- |
| `skill_catalog` | optional scope                         | every skill's name and description |
| `skill_find`    | `intent`, a sentence; optional `limit` | ranked matches                     |
| `skill_call`    | `name`                                 | that skill's body                  |

## Worked examples

### Reading the catalog without a server

```ts
import { readCatalog } from "pmcp";

const catalog = readCatalog({ roots: ["./node_modules"] });
console.log(`${catalog.length} skills`);
for (const entry of catalog.slice(0, 3)) {
  console.log(`${entry.name}: ${entry.description}`);
}
```

### Asking a question rather than a keyword

`skill_find` ranks descriptions, which are written as symptoms, so a sentence
retrieves and a bare noun does not. This is the difference the tool descriptions
are trying to teach, and it is easy to get wrong:

```ts
// Retrieves: the sentence shares vocabulary with a symptom description.
await client.callTool({
  name: "skill_find",
  arguments: {
    intent: "my build copies dist into the image but a stale bundle ships",
  },
});

// Does not: one word matches many descriptions weakly and none strongly.
// Use skill_catalog for this shape of question; it filters rather than ranks.
await client.callTool({ name: "skill_find", arguments: { intent: "build" } });
```

### Scoping a large tree

```ts
const mine = readCatalog({
  roots: ["./node_modules"],
  scopes: ["@acme/"],
});
```

The prefix is matched against the package name with `startsWith`, so `@acme`
also matches `@acmetools/thing`. Include the trailing slash when you mean the
scope.

## Testing against it

### Build a tree, do not mock the filesystem

`readCatalog` takes roots, so a test supplies a real temporary directory. This
is faster than a filesystem mock and it exercises the walk rather than a stand-in
for it.

```ts
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readCatalog } from "pmcp";

const root = mkdtempSync(join(tmpdir(), "skills-"));
const pkg = join(root, "node_modules", "example");
mkdirSync(join(pkg, "skills", "wiring"), { recursive: true });
writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: "example" }));
writeFileSync(
  join(pkg, "skills", "wiring", "SKILL.md"),
  "---\nname: wiring\ndescription: Something breaks and you need this.\n---\n\nbody\n",
);

const catalog = readCatalog({ roots: [join(root, "node_modules")] });
```

### Assert on what was found, never that something was found

```ts
// Proves nothing: passes on an empty tree and on a broken walk alike.
expect(catalog).toBeDefined();

// Proves the walk reached this package under this convention.
expect(catalog.map((entry) => entry.name)).toContain("example/wiring");
```

A test that asserts a non-empty result cannot distinguish a catalog that found
the wrong thing from one that found the right thing. Name the entry.

## Invariants

- **Discovery is derived, never declared.** Installing a package is how its
  skill arrives and uninstalling it is how the skill leaves. There is no list.
- **A skill without a description is not catalogued.** Ranking is over
  descriptions, so an entry without one could only be reached by already knowing
  its name.
- **The first root wins.** A nested `node_modules` holds an older copy of an
  already-resolved package; the outer one is the one the project runs.
- **Absence is not failure.** No model, no SQLite, and an unreadable file each
  degrade the answer rather than ending the request, and the response says which
  path answered so a fallback is visible rather than silent.
- **Startup does not grow with the catalog.** Bodies are read by `skill_call`,
  one at a time. Adding a dependency that ships ten skills adds ten short
  descriptions, not ten documents.

## What it will not do

The MCP tools read installed files and return text. They do not install packages
or make catalog API requests. The CLI's available, install and sync commands are
separate from that local reading path.

The CLI does not write directly into node_modules or treat OAuth access tokens
as npm credentials. Installation uses the project's npm or Bun configuration,
requires confirmation, and verifies registry integrity and the installed version.
Use --dry-run to inspect changes without applying them. Sync does not delete
unrelated dependencies or skills authored by the user.

It will not parse full YAML. Frontmatter is read as flat scalars, so a nested
structure is ignored rather than half-understood.

The default server ranks lexically. The optional index command requires
`@huggingface/transformers` and may load model assets when explicitly invoked.
Installing that peer alone is not proof that the server uses its index.
No postinstall hook downloads a model.
