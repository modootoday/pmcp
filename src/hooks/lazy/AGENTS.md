# Lazy builtins for the hook bundle

Follow the [hook rules](../AGENTS.md) and [package rules](../../../AGENTS.md).

- Only the hook bundle uses these: tsup.config.ts points node:child_process and node:crypto here.
- Each export takes the real module from process.getBuiltinModule on first call, never at import.
- Keep the exported signatures identical to Node's; add a name only when the bundle imports it.
