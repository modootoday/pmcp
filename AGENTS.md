# pmcp contributor rules

Constraints for edits to this package; each says what breaks without it. How to build, test
and check documentation is in CONTRIBUTING.md. Rust crates add crates/AGENTS.md.

- Optional local supervision belongs to the CLI host only; MCP server entries cannot reach
  it, or an MCP client would gain a way to start and drive processes.
- Provider authentication stays native. Do not add organization policy, identity or audit
  retention to this package.
- Keep CLI routing thin, domain responsibilities separate and the terminal transport behind
  its adapter. The TUI consumes the complete CLI contract, so a shortcut couples the two.
- Add tool output fields only when the call supplies the new opt-in input. Keep outputSchema
  open and preserve `__tests__/output-compat.test.ts`: existing clients validate the old
  shape.
- Generate runtime configuration from canonical sources. Preserve unmanaged entries,
  credential references and native trust requirements, or a projection overwrites the user's
  own settings.
- Never put credentials, native auth profiles, session transcripts or paths from your own
  machine in this package: the repository and the npm package are public.
- Keep published relative documentation links valid through package.json files: `docs/*.md`
  ship in the npm package.
- Format with `bun run format` (prettier); `format:check` fails otherwise. Comments are
  English and say why, in at most three lines: longer ones are skipped and go stale.
