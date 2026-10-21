# pmcp contributor rules

These instructions govern edits to this package. User-facing documentation
belongs in README.md and docs/.

- Keep README.md focused on installation, supported features and user workflows.
- Keep detailed public configuration and integration examples in docs/.
- Keep agent instructions in AGENTS.md files next to the code they govern.
- Optional local supervision belongs to the CLI host only; MCP server entries
  cannot reach it. Provider authentication stays native. Do not add
  organization policy, identity or audit retention to this package.
- Keep CLI routing thin, domain responsibilities separate and the terminal
  transport behind its adapter. The TUI consumes the complete CLI contract.
- Add tool output fields only when the call supplies the new opt-in input.
  Keep outputSchema open and preserve `__tests__/output-compat.test.ts`.
- Generate runtime configuration from canonical sources. Preserve unmanaged
  entries, credential references and native trust requirements.
- Never put credentials, native auth profiles, session transcripts or paths
  from your own machine in this package.
- Keep published relative documentation links valid through package.json files.
- Format with `bun run format` (prettier); `format:check` fails otherwise.
  Comments are English and say why, in at most three lines: longer ones are
  skipped and go stale.
- Use the package's typecheck and test scripts for code changes. Documentation
  changes need link, packaging and formatting checks; avoid rebuilding
  unrelated runtime artifacts.
