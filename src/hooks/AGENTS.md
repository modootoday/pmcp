# src/hooks

Rules for the hook core. Package rules: ../../AGENTS.md. User-facing behaviour:
../../docs/hooks.md.

- contract.ts imports nothing. Dependencies point one way: runtimes -> contract <- policies.
- Runtime strings (native event names, tool names, output field names) appear only under
  runtimes/<id>/. **tests**/hooks/structure.test.ts enforces it.
- The bundle (entry.ts -> dist/hook-body.js -> .agents/pmcp-hooks/hook-body.mjs) loads contract,
  runtimes, policies, dispatch, the logger, the files store and node builtins only. Never zod,
  smol-toml, yaml, the MCP server, compile, or any CLI module. loader.ts -> hook.mjs only enables
  the compile cache and imports the body; a body that fails to load fails open.
- Target: median hook run at or under 100 ms, at most 30 ms over bare node. Do not spawn processes
  on the common path; git facts come from ../sessions/checkout.ts, which reads .git files.
- In the bundle, node:fs, node:crypto and node:child_process resolve to lazy shims (tsup.config.ts
  and lazy/): an ESM import of fs alone loads the streams stack, crypto costs about 8 ms. Do not
  hash on the common path; the policy check reuses its verdict through integrity-cache.ts.
- Policies reach session state only through PolicyContext.store; never through file paths.
- policy.json is the only configuration the hook reads, and only when its sha256 matches the
  pmcp.lock entry. compile.ts writes it during pmcp project; the hook never parses toml.
- The native command line is fixed per runtime and event. A policy change must not change it.
- Composition: deny over ask over allow, contexts concatenated. Guards fail closed; bookkeeping,
  notices and checks fail open and log at error.
- An ask on a runtime without ask is lowered by dispatch to ask_fallback; never dropped.
- A Stop that a hook already continued (stop_hook_active) produces no output.
- entry.ts, dispatch.ts, compile.ts only assemble; logic lives in their same-named directories.
