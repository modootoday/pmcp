# Shipping a skill in your package

[Back to the overview](../README.md)

Three things have to be true: the file is somewhere the walk reaches, its frontmatter carries a `description`, and the tarball actually contains it.

## Where the file goes

Any of these, and the walk does not care which. They are the conventions different agents settled on, and one directory read sees them all:

```text
<package>/skills/<slug>/SKILL.md
<package>/.agent/skills/<slug>/SKILL.md
<package>/.claude/skills/<slug>/SKILL.md
<package>/.gemini/skills/<slug>/SKILL.md
<package>/.codex/skills/<slug>/SKILL.md
```

The path is not what makes it a skill; the file is. Each installed package is walked to a depth of three, and any `SKILL.md` found is a skill, so a convention nobody has invented yet works too.

### Where it must not go

The walk skips directories that cannot hold a package's own skill and are expensive or misleading to enter. A `SKILL.md` under any of these is invisible:

| Kind                       | Directories                                                                                 |
| -------------------------- | ------------------------------------------------------------------------------------------- |
| build output               | `dist`, `build`, `out`, `lib`, `es`, `esm`, `cjs`, `umd`                                    |
| sources and types          | `src`, `types`, `typings`, `bin`                                                            |
| test corpora               | `test`, `tests`, `__tests__`, `fixtures`, `__fixtures__`, `example`, `examples`, `coverage` |
| nested installs and caches | `node_modules`, `.git`, `.turbo`, `.cache`                                                  |

The common mistake is authoring the skill in `src/` and letting the build copy it to `dist/`. Both ends of that are skipped. Keep the file at a path that ships as written.

## The frontmatter

```markdown
---
name: release-runbook
description: A deploy went out but the container still runs the old bundle, and rebuilding does not change it.
---

# Releasing

…
```

Two fields are read. `name` becomes the slug, and the skill is addressed as `<package>/<slug>`; leave it out and the directory holding the file names it, or the package itself does when the file sits at the package root.

`description` is the only text that [`skill_find`](getting-started.md) ranks. A skill without one is skipped rather than listed: ranking could never surface it, so listing it would spend a session's tokens on an entry that cannot answer.

The reader is not a YAML parser. It takes flat scalars on their own line, strips one pair of surrounding quotes, and ignores anything nested. That is the honest limit rather than a partial YAML, and it means a description folded over several lines is not read as you intended.

## Write the description as a symptom

A reader arrives with a problem, not with your vocabulary. They will not type your package's name, because not knowing it is why they are asking. Descriptions that name the symptom are the ones a sentence can reach.

| Instead of                                                    | Write                                                                                               |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `Utilities for distributed locks, leases and fencing tokens.` | `A job ran twice because two workers took the same lock, or a lock outlived the worker holding it.` |
| `Deployment helpers and image build configuration.`           | `A deploy went out but the container still runs the old bundle, and rebuilding does not change it.` |

Both halves of the lexical score reward this. It compares the words of the question against the words of the description, and a feature list shares its words with every other feature list in the catalog.

Name the failure, the surprise, and the thing the reader already tried. One or two sentences. It is read by whoever is choosing between five candidates, so it is a filter, not a summary of the body.

## Ship the file

```json
{
  "files": ["dist", "skills", "README.md"]
}
```

A `SKILL.md` outside the manifest's `files` array is not in the tarball, and therefore not in anyone's `node_modules`. This fails quietly: your repository has the skill, your tests find it, and no consumer ever sees it.

Check by installing your own tarball into an empty project and running `npx -y @modootoday/pmcp list` there. If the name is not in that output, no agent will find it either.

## The body

Everything after the closing `---` is the body, and `skill_call` returns it whole. It is read on its own, by someone who has seen only the description, so it should not depend on the rest of your documentation site to make sense.

**Two skills can share a name only once.** The catalog is keyed by `<package>/<slug>` and the first root wins, so a nested copy of your package is ignored in favour of the one the project actually resolved.
