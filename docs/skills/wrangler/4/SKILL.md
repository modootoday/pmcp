---
name: wrangler
description: Use Wrangler ^4.0.0 programmatically from Node.js, while avoiding deprecated v3 APIs, accidental remote data access, and assumptions that the CLI or Worker runtime is available in a plain script.
---

Verified against wrangler@4.129.1 on 2026-09-07. 4 of 4 examples executed.

# wrangler ^4.0.0

## Scope

Wrangler is primarily a CLI and build runner. The v4 programmatic API exposes helpers for Node.js applications and integration testing, but a plain Node.js script does not execute a Worker with production semantics by itself.

Install or update with:

```sh
npm i -D wrangler@4
npx wrangler --version
```

Wrangler v4 no longer supports Node.js 16. Use a Node.js release in Node.js's Current, Active LTS, or Maintenance LTS lines.

## Programmatic exports

The documented v4 exports are:

- `createTestHarness`
- `experimental_generateTypes`
- `unstable_startWorker`
- `unstable_dev`
- `getPlatformProxy`

Check the installed package's exports before relying on an API:

```ts pmcp-example
import { strict as assert } from "node:assert/strict";
import {
  createTestHarness,
  experimental_generateTypes,
  getPlatformProxy,
  unstable_dev,
  unstable_startWorker,
} from "wrangler";

assert.equal(typeof createTestHarness, "function");
assert.equal(typeof experimental_generateTypes, "function");
assert.equal(typeof getPlatformProxy, "function");
assert.equal(typeof unstable_dev, "function");
assert.equal(typeof unstable_startWorker, "function");
```

### `createTestHarness`

Use this for integration testing. It accepts optional configuration and returns a harness with:

- `listen(): Promise<{ url: URL }>`
- `fetch(input, init): Promise<Response>`
- `getWorker(name?): WorkerHandle`
- `getLogs(): WorkerdStructuredLog[]`
- `clearLogs(): void`
- `debug(): void`
- `update(optionsOrUpdater): Promise<void>`

A multi-Worker configuration can reference Wrangler config files:

```ts
const server = createTestHarness({
  workers: [
    { configPath: "./wrangler.web.jsonc" },
    { configPath: "./wrangler.api.jsonc" },
  ],
});
```

Do not copy this configuration into a standalone example unless those config files exist. A direct script has no test runner, fixture setup, or generated configuration. The harness itself is the programmatic API intended for integration tests.

```ts pmcp-example
import { strict as assert } from "node:assert/strict";
import { createTestHarness } from "wrangler";

const server = createTestHarness();

assert.equal(typeof server.listen, "function");
assert.equal(typeof server.fetch, "function");
assert.equal(typeof server.getWorker, "function");
assert.equal(typeof server.getLogs, "function");
assert.equal(typeof server.clearLogs, "function");
assert.equal(typeof server.debug, "function");
assert.equal(typeof server.update, "function");
```

### `unstable_dev`

`unstable_dev(script, options?)` starts a development Worker and returns an object with:

- `fetch(): Promise<Response>`
- `stop(): Promise<void>`

The API starts Wrangler's local development machinery, so a real use needs a Worker script and suitable options. Always stop the returned worker when finished:

```ts
const worker = await unstable_dev(script, options);
try {
  const response = await worker.fetch();
  // inspect response
} finally {
  await worker.stop();
}
```

This API is distinct from running `npx wrangler dev`; it is still Wrangler-owned development execution, not ordinary Node.js Worker execution.

### `getPlatformProxy`

Use `getPlatformProxy(options?)` only from a Node.js application. It resolves to:

```ts
{
  env,
  cf,
  ctx,
  caches,
  dispose(): Promise<void>
}
```

Supported options include `environment`, `configPath`, `persist`, and `remoteBindings`.

The proxy provides best-effort local `workerd` binding emulation. It cannot run inside a Worker. Dispose it when finished:

```ts
const platform = await getPlatformProxy(options);
try {
  const { env } = platform;
  console.log(`MY_VARIABLE = ${env.MY_VARIABLE}`);
} finally {
  await platform.dispose();
}
```

A standalone invocation generally needs a Wrangler configuration and any bindings referenced by that configuration, so do not assume `getPlatformProxy()` can demonstrate useful bindings with no project setup.

```ts pmcp-example
import { strict as assert } from "node:assert/strict";
import { getPlatformProxy } from "wrangler";

assert.equal(typeof getPlatformProxy, "function");
```

### `experimental_generateTypes`

`experimental_generateTypes(options)` generates TypeScript definitions from Wrangler configuration. It returns generated type content as structured strings; it does not automatically write the definitions to disk.

This operation is configuration-dependent. Supply the relevant Wrangler options from the project rather than assuming a default configuration exists.

```ts pmcp-example
import { strict as assert } from "node:assert/strict";
import { experimental_generateTypes } from "wrangler";

assert.equal(typeof experimental_generateTypes, "function");
```

### `unstable_startWorker`

`unstable_startWorker` exists, but it is deprecated. Prefer `createTestHarness()` for integration testing.

## CLI and build behavior

The CLI owns local runtime execution, bundling, deployment, and custom build commands. Typical commands are:

```sh
npx wrangler dev
npx wrangler deploy
npx wrangler deploy --dry-run --outdir dist
```

Built-in bundling runs during `wrangler dev` and `wrangler deploy`. A custom build is also runner-owned and can be configured with:

```json
{
  "build": {
    "command": "npm run build",
    "cwd": "build_cwd",
    "watch_dir": "build_watch_dir"
  }
}
```

Do not put CLI-injected globals such as `describe`, `it`, or `expect` in a direct Node.js example. They are not available when an example is run as `bun example.ts`.

## v4 migration traps

- `wrangler publish` is replaced by `wrangler deploy`.
- `wrangler generate` is replaced by `npm create cloudflare@latest`.
- `wrangler pages publish` is replaced by `wrangler pages deploy`.
- `wrangler version` is replaced by `wrangler --version`.
- `getBindingsProxy()` is replaced by `getPlatformProxy()`.
- `--legacy-assets` and `legacy_assets` are replaced by Workers Static Assets.
- `--node-compat` and `node_compat` are replaced by the `nodejs_compat` compatibility flag.
- `usage_model` should be removed; it has no effect.
- Workers Sites and Service Environments (`legacy_env`) remain deprecated.

### Local versus remote data

In v4, commands supporting both local and remote operation default to local. Add `--remote` when you intentionally need API or production data.

This especially affects:

- `wrangler kv key ...`
- `wrangler kv bulk ...`
- `wrangler r2 object ...`

For example, the old remote-default KV behavior now requires:

```sh
wrangler kv key get --binding MY_KV "my-key" --remote
```

## What this skill does not cover

This skill does not cover Wrangler configuration schemas, binding-specific options, the detailed `WorkerHandle` shape, response or log schemas, deployment authentication, production data workflows, or the exact options required by a particular project. It also does not provide a standalone `unstable_dev`, harness, or type-generation execution fixture because those operations depend on Worker scripts or Wrangler configuration not supplied by the research.
