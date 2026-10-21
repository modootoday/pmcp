# exception

Our Grok Build CI step passes `--permission-mode default --allow mcp__docs__search`, and the MCP call never happens, yet the step exits 0. Fix it.

## PASS

- Says Grok matches `--allow docs__search`, not the Claude-style `mcp__docs__search`.
- Warns that a `defaultMode` in `~/.claude/settings.json` can override Grok's own flags, and isolates the CI home or settings.
- Adds an assertion that the call happened.
