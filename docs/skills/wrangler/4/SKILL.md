---
name: wrangler
description: Generate configuration-driven Worker types and validate local bindings with Wrangler 4.x. Use the project's installed CLI and an isolated local runner; distinguish local evidence from remote deployment behavior.
compatibility: Wrangler 4.90.1 with Node.js 22 or newer. Newer Wrangler documentation may describe unavailable exports and commands.
---

# Wrangler 4.x development contracts

The previous delivery recorded four programmatic API examples against Wrangler
4.129.1 on 2026-09-07. That evidence belongs to that archived delivery; it does
not establish that those exports exist in earlier 4.x releases.

## Start from the installed version and configuration

Use the project's package scripts and local Wrangler dependency. Check its
version and relevant help before selecting flags. Wrangler 4.90.1 does not
expose the newer `createTestHarness` API; importing it from this version fails.
An unstable programmatic helper needs the installed package's actual signature.

Use the same explicit config and environment for type generation and execution.
For frameworks that generate Wrangler config, change the source rather than
editing generated output. Preserve the project's compatibility date and flags
unless the task includes reviewing and testing a runtime migration.

## Generate and check binding types

```sh
wrangler types worker-configuration.d.ts --config wrangler.json
wrangler types worker-configuration.d.ts --config wrangler.json --check
```

Generated `Env` describes configured variables and bindings. Include the generated
file in the Worker TypeScript project. Keep custom source-owned interfaces
separate; do not hand-edit generated bindings or duplicate them with `any`.

`--strict-vars` defaults to true and produces literal or union types for variables.
Use false when intentionally requesting general string types. `--check` detects
changed generation inputs; it does not type-check application code or verify
the generated declaration body. Run both checks when changing bindings.

An unknown binding or invalid KV value should fail compilation. A configuration
change should make `types --check` fail until types are regenerated. A passing
hash check cannot prove that the referenced remote resource exists.

## Exercise the configured local runtime

For a local integration fixture on Wrangler 4.90.1:

```ts
import { unstable_dev } from "wrangler";

const worker = await unstable_dev("worker.js", {
  config: "wrangler.json",
  local: true,
  persist: false,
});
try {
  const response = await worker.fetch("/");
  if (!response.ok) throw new Error(`Worker returned ${response.status}`);
} finally {
  await worker.stop();
}
```

Test a valid request, rejection before writes, and read-after-write through the
Worker handler. Dispose the runner even when an assertion fails. Give fixtures
their own configuration and state; a local Worker can still use remote bindings
when configured that way, so inspect binding targets rather than trusting the
word "local" alone.

`getPlatformProxy` is a Node helper for accessing bindings and needs `dispose()`.
Calling a handler directly with its proxied `env` does not execute that handler
inside workerd. Use a local Worker runner when making runtime claims.

## Keep remote operations task-scoped

Neither local type generation nor local integration testing requires an account
login, deployment, or production data access. For requested remote work, identify
the intended config, environment and resources first. A dry-run bundle validates
packaging, not remote permissions or resource behavior. Secrets stay outside
public configuration, source and command logs.

## Sources

- [Wrangler types and command reference](https://developers.cloudflare.com/workers/wrangler/commands/workers/#types)
- [Workers TypeScript configuration](https://developers.cloudflare.com/workers/languages/typescript/)
- [Cloudflare's official Wrangler skill](https://github.com/cloudflare/skills/blob/0871daceb347e3c51693fbe9c77555468df7e410/skills/wrangler/SKILL.md)
