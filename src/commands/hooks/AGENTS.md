# Hook inspection commands

Follow ../AGENTS.md and ../../../AGENTS.md.

- Keep list and test behind separate dynamic imports.
- Native field names belong to runtime adapters, not CLI modules.
- Seed only temporary state; preserve the source file and the real session store.
- Report skipped effects and rendered output without claiming a live runtime result.
