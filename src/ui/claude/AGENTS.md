# src/ui/claude rules

This directory is the source of the pmcp Claude mod. `scripts/marketplace/mod.mjs` copies it
to `plugins/pmcp/mod/`; never edit the generated copy.

- The mod never decides. Hooks refuse; the mod reads state, draws it, writes only the pause and
  broadcast files its commands own, and relays the person's answer in the foreign-edit ask.
- Missing `[ui.claude]` means off: without `.agents/pmcp-hooks/ui-claude.json` the mod
  registers nothing. Each switch (`sessions_pane`, `status_band`, `commands`,
  `hold_foreign_edits`) gates exactly one surface.
- `reader/` is host-agnostic: no `claude-code`, no `node:` imports, file access only through
  `StateFiles`. It is typechecked and tested with the package; the files beside it are host
  modules excluded from the package tsconfig and run only inside Claude.
- `reader/` reads through `src/sessions/format.ts` and `types.ts`, which have no imports;
  `mod.mjs` ships them as `mod/sessions/` and relinks the imports. Never redefine a state
  file name, shape or the liveness rule here.
- The state directory is `[sessions].state_dir` when declared, else `hook.mjs --state-dir`;
  the mod never reads `~/.claude/sessions` and never computes the directory itself.
- Imports stay extensionless (`./reader/index`), the form the Claude mod loader resolves.
- Only the Claude manifest lists the mod; the portable `plugin.json` never does.
- Timestamps are UTC ISO strings.
