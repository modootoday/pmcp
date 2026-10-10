---
name: rolldown
description: Use Rolldown 1.x programmatically, with the current JavaScript API shape, standalone transform utilities, and correct bundle/plugin lifecycle handling.
---

Verified against rolldown@1.2.7 on 2026-09-08. 2 of 2 examples executed.

# rolldown

## Scope

This skill covers the documented Rolldown `^1.0.0` JavaScript API and the standalone transform utility. The package is Rollup-compatible, but current Rolldown 1.x has important differences from older Rollup-shaped examples.

## Current JavaScript API shape

Import the bundler functions from the package root:

```ts pmcp-example
import assert from 'node:assert/strict';
import { defineConfig } from 'rolldown';

const config = defineConfig({
  input: 'src/main.js',
  output: { file: 'bundle.js' },
});

assert.equal(config.input, 'src/main.js');
assert.deepEqual(config.output, { file: 'bundle.js' });
```

The root-level documented functions include:

- `rolldown`
- `build`
- `watch`
- `defineConfig`
- utility APIs such as `parse`, `parseAst`, `minify`, and related helpers

For a bundle, create a bundle from input options, then generate or write output:

```js
import { rolldown } from 'rolldown';

const bundle = await rolldown({
  input: 'src/main.js',
});

await bundle.generate({ format: 'esm' });
await bundle.generate({ format: 'cjs' });
await bundle.write({ file: 'bundle.js' });
await bundle.close();
```

`build()` accepts the combined input/output shape:

```js
import { build } from 'rolldown';

await build({
  input: 'src/main.js',
  output: {
    file: 'bundle.js',
  },
});
```

`BuildOptions` is input options plus an optional output and optional `write` flag. `write` defaults to `true`.

## The common old-API mistake

Do not carry over a config-file shape blindly to `rolldown()`.

The JavaScript API separates input options from output options when using `rolldown()`:

```js
import { rolldown } from 'rolldown';

const bundle = await rolldown({
  input: 'src/main.js',
});

await bundle.write({
  file: 'bundle.js',
});
```

The `build()` API instead accepts the combined shape:

```js
import { build } from 'rolldown';

await build({
  input: 'src/main.js',
  output: { file: 'bundle.js' },
});
```

CLI/config-file usage may use output arrays and config arrays. The plain JavaScript API does not accept config arrays, promises, or functions in place of its options object. Call `rolldown()` separately for each input-options set.

## Standalone transform utility

`transform` is exported from `rolldown/utils`, not the package root. It accepts a filename, source text, optional transform options, and an optional TypeScript config cache:

```ts pmcp-example
import assert from 'node:assert/strict';
import { transform } from 'rolldown/utils';

const result = await transform(
  'example.js',
  'const value = 1;',
  null,
  null,
);

assert.equal(typeof result, 'object');
assert.notEqual(result, null);
```

The signature is:

```ts
transform(
  filename: string,
  sourceText: string,
  options?: TransformOptions | null,
  cache?: TsconfigCache | null,
): Promise<TransformResult>
```

This is the most useful part of the documented surface for a direct script that has no input files, output directory, runner, or CLI process.

## Watch mode

`watch()` is Rollup-compatible, but closing the watcher is asynchronous:

```js
import { watch } from 'rolldown';

const watcher = watch({
  // watcher options
});

watcher.on('event', () => {});

await watcher.close();
```

Do not omit `await` from `watcher.close()`.

## Bundle lifecycle and plugins

The JavaScript API user must call `bundle.close()` after generation or writing. The CLI calls plugin `closeBundle` after each run; the JavaScript API does not replace that lifecycle step automatically.

Rolldown's plugin API is almost fully compatible with Rollup, but output lifecycle details differ:

- Each output is processed separately.
- `outputOptions` runs before build hooks.
- Build hooks run per output.
- `closeBundle` runs only after `generate()` or `write()`.

Stateful plugins that assume Rollup's output-hook ordering or single-build behavior need particular care.

## Configuration and CLI boundaries

Config files are loaded by the CLI. The default config loader bundles the config with Rolldown; `native` requires a runtime that can import the config directly.

CLI config exports may be functions and config arrays. Those forms are not accepted as plain JavaScript API options. Keep CLI configuration concerns separate from direct calls to `rolldown()` and `build()`.

## Version-transition notes

The `^1.0.0` range permits later 1.x versions, so check the installed 1.x behavior when relying on prerelease-era details. The project changelog records these breaking changes before final 1.0:

- TypeScript config auto-discovery became enabled by default in `1.0.0-beta.60`.
- `minify: 'dce-only'` became the default in `1.0.0-rc.7`.
- `inlineConst: { mode: 'smart', pass: 1 }` became the default in `1.0.0-rc.7`.
- `BindingMagicString` was renamed to `RolldownMagicString` in `1.0.0-rc.9`.
- Built-in CSS bundling was dropped and CSS filename options were removed in `1.0.0-rc.6`.
- `rolldown:runtime` was renamed to `\0rolldown/runtime.js` in `1.0.0-rc.2`.

## What this skill does not cover

This skill does not cover the complete option, hook, AST, parser, minifier, watcher-event, or plugin-hook signatures. It also does not cover CLI invocation details, config-file discovery in a particular project, filesystem-backed bundling setup, or network-dependent behavior. Bundle examples requiring input files and output files are described but are not runnable as standalone examples under the no-filesystem constraints.
