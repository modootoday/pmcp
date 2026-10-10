---
name: tsx
description: Use tsx v4 as a Node-compatible TypeScript loader, or use its documented ESM/CJS Developer APIs from a plain script. Covers v4 changes, dynamic loading, scoped registration, and the boundary between the API and the tsx CLI.
---

Verified against tsx@4.23.13 on 2026-09-07. 2 of 2 examples executed.

# tsx

## Scope

This skill targets `tsx` `^4.0.0`. It covers the documented package entry points and Developer APIs, plus the CLI features shown by the research. `tsx` is a drop-in `node` replacement that adds TypeScript support, CommonJS/ESM interoperability, `tsconfig.json` paths, and esbuild-based transformation. It does not perform type checking.

The runnable examples below are standalone Bun scripts. The package-entry, `tsImport`, and enhanced-`require` smoke tests were not retained because they failed when run standalone under the supplied Bun environment; see [Standalone-runtime limitation](#standalone-runtime-limitation).

## v4 corrections

- Use the `TSX_` environment-variable prefix. `ESBK_` is the v3-era prefix and is not the v4 prefix.
- v4 supports Node.js LTS versions 18 and newer. Do not target Node.js versions below 18.
- v4 added resolver support for `.tsx` and `.jsx`.
- CommonJS import specifiers may contain queries.
- Transformation warnings are emitted through stderr.

## CLI usage

Install it as a development dependency with `npm install -D tsx`, then run a TypeScript file with `tsx file.ts`. The general command shape is:

`tsx [tsx flags] ./file.ts [flags & arguments for file.ts]`

A package script can use `tsx ./file.ts`, and `npx tsx ./script.ts` also works without a local installation.

The equivalent Node integration is `node --import tsx ./file.ts`.

## Package entry points

The package entry point automatically registers TypeScript loading for subsequent imports:

```ts
import 'tsx'

const loaded = await import('./file.ts')
```

For CommonJS-only mode, use `require('tsx/cjs')`. For module-only mode, use `import 'tsx/esm'`.

The package entry point is a loader setup, not a value-oriented API. Use it when the surrounding runtime can perform the subsequent TypeScript import. The standalone smoke test from the earlier draft failed under the supplied Bun execution environment with a missing `./cjs/index.cjs` module, so this skill does not claim that smoke test is portable to that environment.

## Dynamic ESM loading: `tsx/esm/api`

`tsx/esm/api` exports named `tsImport`. It dynamically imports a TypeScript module, with the second argument supplying import context:

```ts
import { tsImport } from 'tsx/esm/api'

const loaded = await tsImport('./file.ts', import.meta.url)
```

The options form accepts `parentURL` and can select a custom tsconfig:

```ts
const loaded = await tsImport('./file.ts', {
  parentURL: import.meta.url,
  tsconfig: './custom-tsconfig.json'
})
```

The documented options also include `tsconfig: false` and an `onImport` callback receiving the imported file path.

Do not use a built-in module as a portability smoke test for this API. The earlier standalone example calling `tsImport('node:path', import.meta.url)` failed under the supplied Bun environment because the generated `tsx://...` module could not be resolved. The research does not establish a standalone Bun-compatible substitute.

## Enhanced CommonJS loading: `tsx/cjs/api`

`tsx/cjs/api` exports a named enhanced `require` function. Its documented usage supplies the request and parent path:

```ts
import { require } from 'tsx/cjs/api'

const loaded = require('./file.ts', import.meta.url)
```

The function also exposes `.resolve` and `.cache`:

```ts
const filepath = require.resolve('./file.ts', import.meta.url)
```

The earlier standalone example using `node:path` failed under the supplied Bun environment while invoking the enhanced loader. It is therefore not presented as a runnable standalone example. The documented API remains the relevant shape for a compatible Node/CommonJS integration.

## Scoped CJS registration

`tsx/cjs/api` exports `register`. It returns an `unregister` cleanup function, or a scoped API containing `require` and `unregister`:

```ts
const tsx = require('tsx/cjs/api')
const unregister = tsx.register()
const loaded = require('./file.ts')
unregister()
```

Use the cleanup function when the registration is no longer needed.

```ts pmcp-example
import { register } from 'tsx/cjs/api'
import assert from 'node:assert/strict'

const unregister = register()

assert.equal(typeof unregister, 'function')
unregister()
```

## Scoped ESM registration

`tsx/esm/api` also exports `register`. It returns an `unregister` cleanup function, or a scoped API containing `import` and `unregister`:

```ts
import { register } from 'tsx/esm/api'

const unregister = register()
await import('./file.ts')
unregister()
```

```ts pmcp-example
import { register } from 'tsx/esm/api'
import assert from 'node:assert/strict'

const unregister = register()

assert.equal(typeof unregister, 'function')
unregister()
```

## CLI-only features

These features are exercised by the `tsx` command itself rather than by the Developer API:

- Watch mode: `tsx watch ./file.ts`
- Watch includes: `--include ./other-dep.txt` and `--include "./other-deps/*"`
- Watch exclusions: `--exclude "./data/**/*"`
- Disable watch-screen clearing with `--clear-screen=false`
- The TypeScript REPL, entered by running `tsx` with no script
- Node's enhanced test runner, invoked with `tsx --test`

Watch mode reruns when dependencies change. The Developer API does not provide watch mode or the REPL. `describe`, `it`, and `expect` are not available in a directly executed script; test files use the tool's test-runner integration instead.

## Standalone-runtime limitation

In the supplied standalone Bun execution, these documented loading operations did not produce runnable examples:

- importing the package entry point failed with a missing `./cjs/index.cjs` module;
- `tsImport` failed while resolving its generated `tsx://...` module;
- enhanced `require` failed while loading the built-in-module smoke test.

Those failures are runtime-specific observations from the required standalone execution, not evidence that the documented Node integration shapes should be changed. Registration itself was independently runnable, so those examples are retained.

## Does not cover

This skill does not cover the full CLI flag set, watch-mode dependency semantics beyond the documented include/exclude options, REPL behavior, `tsx --test` test discovery, TypeScript compiler type checking, undocumented loader internals, Bun-specific compatibility beyond the observed standalone failures, or configuration details not shown in the supplied research.
