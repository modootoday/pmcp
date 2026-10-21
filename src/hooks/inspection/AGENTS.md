# src/hooks/inspection rules

Follow the package rules in ../../../AGENTS.md.

- Inspections use scratch session state and never execute configured commands or move worktrees.
- Report skipped external effects explicitly; do not claim those policies were evaluated.
- Keep native payload construction under runtimes, and reuse dispatch and rendering.
