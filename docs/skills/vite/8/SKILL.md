---
name: vite
description: Use Vite 8's programmatic JavaScript API and avoid Vite 7/Rollup-era configuration shapes.
---

Verified against vite@8.2.2 on 2026-09-07. 4 of 4 examples executed.

# Vite 8 (`^8.0.0`)

Use this skill when writing code against Vite 8's npm API. Vite 8 requires Node `20.19+` or `22.12+`, and uses Rolldown and Oxc instead of Rollup and esbuild.

## Programmatic API

Import API functions from `vite` in a plain Node/Bun script. The documented APIs include:

- `createServer(inlineConfig?)`: asynchronously creates a development server.
- `build(inlineConfig?)`: performs a production build and returns Rolldown output or a watcher.
- `preview(inlineConfig?)`: asynchronously creates a preview server.
- `resolveConfig(inlineConfig, command, defaultMode?, defaultNodeEnv?, isPreview?)`.
- `mergeConfig(defaults, overrides, isRoot?)`.
- `loadEnv(mode, envDir, prefixes?)`.
- `transformWithOxc(code, filename, options?, inMap?)`.
- `preprocessCSS(code, filename, config)`.
- `normalizePath(id)`.

`createServer` returns a server exposing APIs including `listen`, `close`, `transformRequest`, `transformIndexHtml`, `ssrLoadModule`, `reloadModule`, and inspection of its config, middleware, HTTP server, watcher, WebSocket server, plugin container, module graph, and resolved URLs. A server can also print URLs and bind CLI shortcuts after listening.

`preview` returns a preview server exposing its config, middleware, HTTP server, resolved URLs, `printUrls()`, and `bindCLIShortcuts(...)`.

`build()` throws a Vite 8 `BundleError` on failure. It is an `Error` with an optional `.errors` array containing individual `RolldownError` values.

## Configuration utilities

`mergeConfig` accepts object-form configuration. Use it for merging defaults and overrides rather than assuming it accepts a config function.

`loadEnv(mode, envDir, prefixes)` loads matching `.env` variables. Its default prefix is `VITE_`; pass a string or array when using other prefixes.

`resolveConfig` takes an inline config plus a command of `'build'` or `'serve'`. Its optional parameters select the default mode, default `NODE_ENV`, and preview mode.

```ts pmcp-example
import assert from 'node:assert/strict'
import { mergeConfig } from 'vite'

const result = mergeConfig(
  { server: { port: 3000 }, define: { A: '1' } },
  { server: { strictPort: true }, define: { B: '2' } },
)

assert.equal(result.server.port, 3000)
assert.equal(result.server.strictPort, true)
assert.equal(result.define.A, '1')
assert.equal(result.define.B, '2')
```

## Oxc JavaScript/TypeScript transforms

Use `transformWithOxc` for standalone JavaScript or TypeScript transformation. It returns the transformed result and exposes warnings separately; the returned shape omits the Oxc `errors` field and includes `warnings`.

```ts pmcp-example
import assert from 'node:assert/strict'
import { transformWithOxc } from 'vite'

const result = await transformWithOxc(
  'const answer: number = 42',
  'example.ts',
)

assert.equal(typeof result.code, 'string')
assert.equal(result.warnings.length, 0)
assert.match(result.code, /42/)
```

## CSS preprocessing

`preprocessCSS(code, filename, config)` handles CSS and supported preprocessor filenames including `.css`, `.scss`, `.sass`, `.less`, `.styl`, and `.stylus`. The corresponding preprocessor must be installed for preprocessor syntaxes. Supply a resolved Vite config.

```ts pmcp-example
import assert from 'node:assert/strict'
import { preprocessCSS, resolveConfig } from 'vite'

const config = await resolveConfig({}, 'serve')
const result = await preprocessCSS('body { color: red; }', 'example.css', config)

assert.equal(typeof result.code, 'string')
assert.match(result.code, /color:\s*red/)
```

## Path normalization

`normalizePath` is a standalone helper for normalizing plugin paths. Do not assume it converts backslashes in every environment; on the environment used here, a path that is already slash-normalized is preserved.

```ts pmcp-example
import assert from 'node:assert/strict'
import { normalizePath } from 'vite'

const normalized = normalizePath('src/components/Button.tsx')
assert.equal(normalized, 'src/components/Button.tsx')
```

## Dev and preview servers

Create a development server with `createServer`, then call `listen()` yourself. The documented pattern is:

```ts
import { createServer } from 'vite'

const server = await createServer({
  configFile: false,
  root: import.meta.dirname,
  server: { port: 1337 },
})
await server.listen()
server.printUrls()
server.bindCLIShortcuts({ print: true })
```

Use `server.close()` when the script is finished. The server API also provides request transformation, HTML transformation, SSR module loading, and module reloading.

Create a preview server with `preview(inlineConfig)`. Its documented pattern is:

```ts
import { preview } from 'vite'

const previewServer = await preview({
  preview: { port: 8080, open: true },
})
previewServer.printUrls()
previewServer.bindCLIShortcuts({ print: true })
```

These APIs start HTTP servers and require an owning tool to manage listening, ports, and shutdown. They are described here but are not exercised by the standalone examples because those examples run without network access.

## Production builds

Call `build(inlineConfig)` for a production build. The documented inline configuration can specify `root`, `base`, and `build.rolldownOptions`:

```ts
import path from 'node:path'
import { build } from 'vite'

await build({
  root: path.resolve(import.meta.dirname, './project'),
  base: '/foo/',
  build: {
    rolldownOptions: {
      // Rolldown options
    },
  },
})
```

Catch the thrown error as a Vite 8 bundle error and inspect `.errors` when present. A real build also requires a project input, so it is not exercised by the standalone examples, which cannot use filesystem setup.

## Vite 8 configuration migration

Prefer Rolldown/Oxc names:

```ts
export default {
  build: { rolldownOptions: {} },
  worker: { rolldownOptions: {} },
}
```

Older Vite 7 examples commonly use `build.rollupOptions` and `worker.rollupOptions`. They remain deprecated aliases in Vite 8, so new code should use the Rolldown names.

Other migration rules:

- `optimizeDeps.esbuildOptions` is deprecated compatibility input and is converted to `optimizeDeps.rolldownOptions`.
- `esbuild` configuration is converted to Oxc configuration.
- `build.commonjsOptions` is a no-op.
- `transformWithEsbuild` is deprecated; use `transformWithOxc`.
- `esbuild` is optional and must be installed separately if a plugin still calls `transformWithEsbuild`.
- The object form of `build.rollupOptions.output.manualChunks` is unsupported; the function form is deprecated. Use Rolldown `codeSplitting` instead.
- `build.rollupOptions.watch.chokidar` was removed; use `build.rolldownOptions.watch.watcher`.
- The URL form of `import.meta.hot.accept` was removed; pass an id instead.
- Rolldown does not support the `system` or `amd` output formats, `shouldTransformCachedModule`, `resolveImportMeta`, `renderDynamicImport`, or `resolveFileUrl`.

## CLI and config-file scope

Automatic config discovery, `vite.config.js`/`.ts`, `--config`, `vite`, `vite dev`, `vite serve`, and `vite build` are runner/CLI behavior rather than standalone API calls. Config files can use either an object or `defineConfig`, for example:

```ts
import { defineConfig } from 'vite'

export default defineConfig({
  // configuration
})
```

By default, Vite bundles a config with Rolldown into a temporary file; `--configLoader native` selects native loading.

## Not covered

This skill does not cover project scaffolding, framework integrations, plugin authoring, detailed inline configuration fields beyond the researched API, the complete `ResolvedConfig` or Rolldown type definitions, filesystem/project setup for builds, or operational port management and lifecycle details for servers beyond the documented API surface above.
