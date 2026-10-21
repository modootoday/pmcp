# Native permissions

Follow the [project rules](../AGENTS.md) and [package rules](../../../AGENTS.md).

- Claude only: rules go into .claude/settings.json permissions.allow, ask and deny when claude is a target.
- Keep each expression verbatim; validate its structure against the pinned grammar, never rewrite it.
- Own single entries through the managed list in pmcp.lock; an identical entry already present is borrowed, never owned.
- Never remove, reorder or deduplicate unmanaged entries, and never touch defaultMode or other settings.
- An owned entry edited or removed by hand is a conflict: report it and refuse to write.
- Codex permissions are a separate feature; do not translate Claude expressions into Codex configuration.
