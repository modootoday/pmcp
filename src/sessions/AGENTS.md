# src/sessions

Rules for session state. Package rules: ../../AGENTS.md. Hook rules: ../hooks/AGENTS.md.

- SessionStore (types.ts) is the only way policies, the CLI and the mod reach session state.
- The files store keeps its documented layout and field names (sessions/<session>.json,
  pause.json, <name>-lease.json, broadcast.json and broadcast-history.jsonl), so other tools
  reading it keep working. Add fields; never rename or retype one. A rename goes through a
  release that writes both names (0.20 writes every record to the deprecated fleet/ too).
- Writes go through a temporary file and a rename; readers never see half a file.
- Liveness is the runtime pid taken at session start plus a heartbeat on every hook event.
  Never read ~/.claude/sessions or any other runtime's private registry.
- The hook bundle loads files-store, checkout, liveness, paths and state-dir. Those modules
  stay free of dependencies and never spawn a process on the common path; cli.ts and status.ts
  are CLI only.
- Git facts on the hook path are read from files (checkout.ts), not by running git.
- State lives outside the repository, in the project state directory or [sessions].state_dir.
- Mailbox messages (messages/<id>.json) are created once by link and never rewritten; delivery
  and acknowledgement are empty markers under inbox/<key>/, and messages.jsonl is append-only.
  A delivery never acknowledges; only pmcp sessions ack does.
