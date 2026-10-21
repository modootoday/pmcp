# Project apply

Follow the [project rules](../AGENTS.md) and [package rules](../../../AGENTS.md).

- `../apply.ts` only assembles: read the lock, plan, check or write, then write the lock.
- One concern per file: lock, presence, replaceability, census, check, backup, files, native merges, legacy rules.
- Parse every touched native JSON file before any write; a bad file stops the run unwritten.
- Never overwrite a file pmcp did not write unless it carries a predecessor projector mark.
- Back up MCP and hook configuration before a write changes it.
- Write pmcp.lock last, with pmcp_version, and never record machine paths in it.
