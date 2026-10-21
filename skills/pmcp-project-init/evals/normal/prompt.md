# normal

Set up this new git repository so Claude Code and Codex read the same instructions and our MCP server `docs` (`url: https://example.com/mcp`). Two agents will work in parallel.

## PASS

- Starts with `pmcp init --preset multi-session` (or writes the equivalent pmcp.toml) and adds `[mcp.docs]`.
- Creates AGENTS.md with CLAUDE.md and GEMINI.md as file links.
- Runs `pmcp project` and `pmcp doctor`, and names the one-time Codex trust step.
