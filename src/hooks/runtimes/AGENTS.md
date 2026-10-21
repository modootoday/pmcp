# src/hooks/runtimes

Rules for runtime adapters. Hook core rules: ../AGENTS.md.

- One runtime per directory, each with adapter, events, payload, output, projection and
  capabilities. A runtime never imports another runtime.
- Adapters depend on contract.ts, runtimes/types.ts and runtimes/climb.ts only; never on policies,
  compile or src/project.
- A projected command never reads an inherited $PWD; one that finds the project itself uses
  climbCommand, and Gemini's names no $NAME at all (Gemini expands them when it loads settings).
- capabilities.ts changes only from a measurement (hook-contract-matrix or a recorded headless
  session); name the runtime version and date in its comment.
- normalize returns null for a payload it does not handle; it never throws on missing fields.
- render writes only shapes the runtime was measured to accept, and no allow decision unless the
  runtime reads silence as a refusal (antigravity); such a runtime also defines silent.
- Context goes only where capabilities.context says it is delivered; dispatch holds the rest.
- Fixtures for every event live in `__tests__/hooks/fixtures/<runtime>/<version>/`. They are
  recorded from real sessions, then normalised by `scripts/hook-fixtures-normalize.mjs` (home,
  project paths, host and ids become placeholders); never written by hand.
