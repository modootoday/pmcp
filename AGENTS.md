# pmcp contributor rules

These instructions govern edits to this package. User-facing documentation
belongs in README.md and docs/. Research, design decisions and pilot evidence
belong in the repository's .spec/ hierarchy.

- Keep README.md focused on installation, supported features and user workflows.
- Keep detailed public configuration and integration examples in docs/.
- Keep agent instructions in AGENTS.md. Long-form invariant rules belong in
  .agents/PACKAGE.md under the repository's documentation layering standard.
- Preserve ADR-PKG-088: optional local supervision belongs to the CLI host only;
  MCP server entries cannot reach it. Provider authentication stays native and
  enterprise policy belongs to private hosted composition.
- Harness controls must pass the independent pilot before source adoption.
  Keep CLI routing thin, domain responsibilities separate and tmux behind its
  adapter. TUI consumes the complete CLI contract.
- Add tool output fields only when the call supplies the new opt-in input.
  Keep outputSchema open and preserve `__tests__/output-compat.test.ts`.
- Generate runtime configuration from canonical sources. Preserve unmanaged
  entries, credential references and native trust requirements.
- Never put credentials, native auth profiles or pilot transcripts in this package.
- Keep published relative documentation links valid through package.json files.
- Follow the repository's source formatting and comment rules.
- Use the package's typecheck and test scripts for code changes, then the
  repository's preflight:changed check. Documentation changes need link,
  packaging and formatting checks; avoid rebuilding unrelated runtime artifacts.
