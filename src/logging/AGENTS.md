# src/logging

Rules for logging. Package rules: ../../AGENTS.md.

- No dependencies beyond node builtins, and no imports from the rest of pmcp; the hook bundle
  loads this directory. cli.ts and query.ts are CLI only and are never imported by the hook.
- [logging] is read by settings.ts; PMCP_LOG overrides the level and component levels at run time.
- Files are named by UTC day and rolled at max_file_mb; retention runs at session start and in
  pmcp logs, never on every hook call.
- JSONL only, one object per line, fields in the order ts, level, component, trace, runtime,
  event, session, policy, verdict, duration_ms, msg, data.
- Files only. Hook stdout belongs to the runtime.
- Timestamps are UTC.
- Secret and environment values are redacted; prompt text is kept as length and hash only.
- A logging failure never changes a hook's answer.
