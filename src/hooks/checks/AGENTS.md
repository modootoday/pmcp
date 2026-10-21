# Hook checks

Follow the [hook rules](../AGENTS.md) and [package rules](../../../AGENTS.md).

- Read neutral inputs only; never import adapters, CLI modules or project code.
- Checks fail open, log failures and report bounded metadata context without child output.
- Resolve validators inside the project and select only owners of edited paths.
- Invoke argv directly; never pass a check command to a shell.
- Store debounce and deferred notices through SessionStore only, scoped by session.
- Persist debounce timestamps as UTC epoch milliseconds across hook processes.
- Run projection checks only after an edit and an inactive stop.
- Run the checkout's own pmcp or the recorded projector at the pmcp.lock version; never pmcp from PATH.
- Emit Claude stop context at most once per turn; defer Codex stop notices to the next prompt.
