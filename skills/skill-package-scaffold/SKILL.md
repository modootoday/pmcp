---
name: skill-package-scaffold
description: Lay out one new skill folder that passes the Agent Skills specification - SKILL.md frontmatter within the limits pmcp validate enforces, references/, scripts/ and assets/ only where needed, and evals/ with a normal, an exception and a missing-information case - then gate it with pmcp validate. Use when creating the folder for a new skill, when pmcp validate rejects a skill, or when a skill needs its first eval cases. Not for deciding what the skill should teach or for packaging several skills as a plugin.
metadata:
  tier: open
  level: L2
  domain: agent-workflow
  install: optional
  keywords: "SKILL.md, skill scaffold, Agent Skills specification, pmcp validate, skill frontmatter, skill evals"
  requires-bin: "pmcp"
---

# Scaffolding one skill folder

This is the shape, not the content. What the body should say, and how to word a description
that triggers, is skill authoring (domain-skill-authoring covers it). Here the job is a
folder that every loader accepts and that carries its own test cases.

## Layout

```
<name>/
  SKILL.md
  references/   only files the body names, read on demand
  scripts/      only code the body tells the agent to run
  assets/       templates or files the output is built from
  evals/
    normal/prompt.md
    exception/prompt.md
    missing-info/prompt.md
```

Create a directory only when something goes in it. An empty `scripts/` makes reviewers look
for code that is not there.

## Frontmatter limits

These are the checks `pmcp validate` runs (pmcp 0.8):

| Field | Rule |
| --- | --- |
| `name` | required; at most 64 characters; lowercase letters, digits and single hyphens, not starting or ending with one; equal to the directory name |
| `description` | required, non-blank; at most 1024 characters |
| `compatibility` | optional string; at most 500 characters |
| `license` | optional string |
| `allowed-tools` | optional; one space-separated string, not a list |
| `metadata` | optional map |

A marketplace may add its own rules on top (a metadata schema, tiers, ASCII-only text).
Check those separately; `pmcp validate` does not know them.

```markdown
---
name: invoice-dispute-reply
description: Draft a reply to a customer disputing an invoice ... Use when ... Not for ...
---
```

## Evals: three cases, each self-contained

| Case | Tests |
| --- | --- |
| normal | the common request, with every input present |
| exception | the input that should change the answer: a rule's exception, an edge value, a refusal |
| missing-info | a request lacking something essential; the skill must ask or state the assumption, not invent |

Each `prompt.md` must carry everything the case needs. The grader's sandbox starts empty, so
paste file contents into the prompt instead of naming a path. Write what PASS means next to
the prompt, as checkable statements, before writing the body.

## Gate

```sh
pmcp validate path/to/<name>           # one folder; exit 1 on any error
pmcp validate --marketplace <dir>      # every skill a marketplace reaches
```

`pmcp validate` checks frontmatter and naming only. It does not run the eval cases; run
those with your eval harness, with and without the skill.

Size matters when the skill is served over MCP: the Skills extension lists a skill only if
it stays within 512 files and 16 MiB. Larger skills stay reachable through the tools.
Scripts are returned as text by catalog servers, never run by them.

## Report

The tree created, the `pmcp validate` output, and the three eval prompts with their PASS
statements.
