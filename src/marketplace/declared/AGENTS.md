# src/marketplace/declared rules

`[marketplaces.<name>]` in pmcp.toml: parsed here once, then used by catalog search, the
projector and doctor.

- Missing table means nothing is declared; nothing here writes a file. `src/project` turns the
  neutral values (`KeyedValue`, TOML text, `MarketplaceCheck`) into outputs and findings; this
  directory never imports `src/project` or `src/config.ts`.
- Runtimes are `claude` and `codex` only, until a runtime's marketplace behaviour is measured.
- Every local source is written as an absolute path resolved from the directory holding
  pmcp.toml. Codex resolves a relative source against the session cwd (measured).
- Codex installation is user state. pmcp writes the project tables and reports the exact
  `codex plugin` command; it never runs an install or touches user config or trust.
- `catalog = true` adds a path source to catalog search; `[catalog].marketplaces` stays an
  alias. A github source cannot be searched locally and is refused with `catalog = true`.
