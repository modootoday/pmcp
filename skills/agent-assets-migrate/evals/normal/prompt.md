# normal

This repository has a 40-line CLAUDE.md and a 36-line GEMINI.md that started as copies, a `.claude/agents/reviewer.md` with frontmatter `name`, `description`, `tools: Read, Grep` and `model: sonnet`, and a `.mcp.json` with one server `docs` (`url: https://example.com/mcp`). Move them to the pmcp layout.

## PASS

- Diffs the two instruction files and keeps the union in AGENTS.md instead of keeping one and dropping the other.
- Makes CLAUDE.md a file-to-file link to AGENTS.md, deletes GEMINI.md, and sets `context.fileName` to `["AGENTS.md"]` in `.gemini/settings.json`.
- Puts the agent at `.agents/agents/reviewer/agent.md` with only name, description and body, and moves `tools` and `model` to `[agents.reviewer.claude]` in pmcp.toml.
- Declares `[mcp.docs]` in pmcp.toml and deletes the hand-written copies before running `pmcp project`.
