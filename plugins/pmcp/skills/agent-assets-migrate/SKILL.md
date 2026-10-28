---
name: agent-assets-migrate
description: Move a repository's scattered agent files - CLAUDE.md, .cursorrules, .windsurfrules, copilot-instructions.md, .claude/skills, .claude/agents, .claude/commands, .gemini/agents and a root .agent/ folder - into one AGENTS.md, .agents/ and pmcp.toml without losing a line, keeping historical citations as they are, and finishing with a clean pmcp project --check. Use when consolidating agent instructions from several tools into one source, when adopting pmcp in a repository that already has agent files, or when agent files have drifted apart. Not for a new empty repository or for trimming an oversized AGENTS.md.
metadata:
  tier: open
  level: L3
  domain: agent-workflow
  install: optional
  keywords: "migrate agent files, AGENTS.md, .agents, pmcp, CLAUDE.md, cursorrules, consolidate rules, subagents"
  requires-bin: "pmcp"
---

# Migrating agent assets into AGENTS.md, .agents/ and pmcp.toml

The risk is not the move; it is silent loss. Two files that look alike usually differ by a
few rules, and a field one tool needed vanishes when an agent file is copied. Inventory
first, move verbatim, prove nothing was dropped, then let `pmcp project` regenerate the
tool files.

## 1. Inventory

List every source with its bytes and line count, and note which are links:

| Found                                                                                         | Goes to                                                                                 |
| --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `CLAUDE.md`, `GEMINI.md`, `.cursorrules`, `.windsurfrules`, `.github/copilot-instructions.md` | merged into `AGENTS.md`; each then becomes a link to it, except `GEMINI.md` (section 2) |
| `.claude/skills/<n>/`, `.agent/skills/<n>/`                                                   | `.agents/skills/<n>/` (whole folder)                                                    |
| `.claude/commands/<n>.md`, `.agent/workflows/<n>.md`                                          | `.agents/skills/<n>/SKILL.md` plus `[skills.<n>] invocation = "user"`                   |
| `.claude/agents/<n>.md`, `.gemini/agents/<n>.md`, `.agent/agents/<n>.md`                      | `.agents/agents/<n>/agent.md`                                                           |
| `.claude/rules/*.md` with `paths:`                                                            | `.agents/rules/<n>.md` with `trigger: glob` and `globs:`                                |
| MCP entries in `.mcp.json`, `.gemini/settings.json`, `.codex/config.toml`                     | `[mcp.<alias>]` in `pmcp.toml`                                                          |

pmcp has no Copilot or Cursor target. Keep those filenames as links to `AGENTS.md` so they
cannot drift.

## 2. Merge instruction files without loss

Diff each instruction file against the others line by line. Keep the union; where two say
different things, settle it from the code or ask, and record the decision. Do not summarise
during the move. Then replace each old file with a link (`ln -s AGENTS.md CLAUDE.md`).
For Gemini CLI, delete every `GEMINI.md` once its text is in the `AGENTS.md` beside it, and
set `"context": { "fileName": ["AGENTS.md"] }` in `.gemini/settings.json` (adding the key if
the file exists): Gemini CLI then reads `AGENTS.md` in each directory itself.
Use file-to-file links only: a directory symlink at the repository root, such as `.agents`
pointing at `.agent`, is rejected by the Codex sandbox.

## 3. Split agent fields

A subagent's `agent.md` keeps only `name`, `description` and the body. Everything else is
tool-specific and becomes a `pmcp.toml` table:

```toml
[agents.reviewer.claude]
tools = "Read, Grep, Glob"
model = "sonnet"
effort = "high"
```

Why: Antigravity silently drops an agent whose `tools` field lists another tool's tool
names. What survives projection: Claude keeps `name`, `description`, `tools`, `model`,
`effort`; Gemini keeps `name` and `description`; Codex gets those two plus the body. A
Gemini-only field has nowhere to go; list it in the report as dropped.

## 4. Keep history as it was

Change live references to the new paths: scripts, configs, current docs, other skills.
Leave decision records, dated plans, changelogs and evidence notes citing the old paths
untouched; they record what was true then. Count both groups and report them.

## 5. Remove the old copies, then project

`pmcp project` refuses to overwrite a file it did not write (exit 1, naming the file), so
delete the hand-written `.claude/agents/<n>.md`, `.claude/skills/<n>` and old MCP blocks
after their content is in the sources. Then:

```sh
pmcp project
pmcp project --check   # must exit 0
```

`--check` exits 2 and names each problem: `drift` (an output differs from its source),
`stale` (the lock lists an output no source produces), `undeclared` (a file left in
`.claude/skills`, `.claude/agents`, `.claude/commands`, `.gemini/agents`, `.codex/agents`,
`.grok/skills` or `.claude/rules/pmcp` that nothing generates, often a copy you forgot to
delete), and `dead glob` (a rule glob matching no tracked file).

Codex in `workspace-write` cannot edit `.agents/` unless it is listed in
`sandbox_workspace_write.writable_roots`; a patch touching it is refused whole.

## 6. Prove nothing was lost

For each old file, check that every non-blank line now exists in a source (same text, or
a recorded decision). Count skills, agents, commands and MCP servers before and after; the
counts must match, with commands now counted as user-invoked skills.

## Report

The inventory table, conflicts and how each was settled, fields dropped, live and historical
citation counts, the before and after asset counts, and the `pmcp project --check` output.
