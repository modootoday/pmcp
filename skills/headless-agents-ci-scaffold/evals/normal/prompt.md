# normal

Write a GitHub Actions job that runs Claude Code headless against our project MCP server `docs` and must call its tool `search`. The job should fail if the tool was not called.

## PASS

- Runs `claude -p` with `--allowedTools mcp__docs__search` (and a permission mode that does not auto-approve everything).
- Asserts on the tool call in the output or transcript, not only on the exit code.
- Gates with `pmcp project --check` and `pmcp doctor`.
