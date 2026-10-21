# Skill validation

Follow the [package rules](../../AGENTS.md) and the [metadata rules](../metadata/AGENTS.md).

- `../validate.ts` only assembles: the Agent Skills specification check, then what `[catalog.validation]` selects.
- A missing `[catalog.validation]` keeps the specification check alone; never add a check by default.
- Profiles come from `src/metadata/profiles`; never copy their rules here.
- A marketplace's tier wins over a skill's own `metadata.tier`.
- Deny-list findings name the list line, never the matched term, and a missing list is an error.
