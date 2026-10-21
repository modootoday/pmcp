# exception

Same migration, but the repository also has `docs/decisions/2025-03-ci.md`, a dated decision record that cites `.claude/agents/reviewer.md`, and a `scripts/check-agents.sh` that reads that path. Update the references.

## PASS

- Changes the path in `scripts/check-agents.sh` to the new location.
- Leaves the dated decision record unchanged and says why (it records what was true then).
- Reports both groups with counts.
