# Metadata invariants

Follow the [package rules](../../AGENTS.md).

- Keep tier and runtime values in schema.ts; profiles consume those definitions.
- Keep the core open to native fields and future metadata; catalog strictness belongs in its profile.
- Inherit skill tier from the marketplace and skill version from the plugin unless it differs.
- Generate catalog and Gemini identity fields from the canonical plugin manifest.
- Keep extensions explicit and namespaced; never mutate a global schema registry.
- Mark evaluation-derived runtime claims as generated.
- Validate marketplace copies outside the package; never commit private fixture contents.
