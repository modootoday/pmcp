---
name: vite
description: Develop and diagnose Vite 8 applications with React integration, environment variables, asset base paths and owned dev-server lifecycle. Maintain Rolldown/Oxc configuration and distinguish production builds from standalone programmatic API checks.
---

Verified against vite@8.2.2 on 2026-09-07. 4 of 4 examples executed.

Those four checks exercise standalone API examples. The application fixture
separately exercises a build and development server; a successful import or
configuration helper does not prove an application builds or renders correctly.

# Vite 8 (`^8.0.0`)

Use this skill when writing code against Vite 8's npm API. Vite 8 requires Node `20.19+` or `22.12+`, and uses Rolldown and Oxc instead of Rollup and esbuild.

## Application workflow

Read the installed Vite, Node and framework-plugin versions. Use the project's
package manager and existing scripts. The fixture pairs Vite 8.2.2 with
@vitejs/plugin-react 6.1.1, React/React DOM 19.2.8 and Tailwind 4.3.3.
Do not migrate an existing Vite 7 app merely because this guide covers Vite 8.

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "/app/",
});
```

Vite removes TypeScript syntax without application typechecking. Keep the
project's TypeScript check. Use base to model a deployment prefix and inspect the
generated HTML's asset URLs. A development server's optimizer and a production
build are different stages; validate both when changing dependency or plugin
resolution. Vite preview checks build output and is not a production web server.

VITE_-prefixed environment variables become public browser data. Keep credentials
outside that prefix, and never define the entire process.env object in a client
bundle. Mode selects environment files; NODE_ENV is a separate setting. Restart
the development server when environment files change and verify production
replacement rather than assuming development values persist.

For custom HTML serving, run transformIndexHtml so framework plugin initialization
is included. Programmatic consumers must close every dev or preview server in a
finally block. Bind a fixture to loopback and leave automatic browser opening off.
The application fixture checks TSX build, base-aware assets, environment exposure,
React Refresh HTML initialization, Tailwind generation and server shutdown. It
does not prove browser layout, interactive HMR or SSR behavior.

For sequential build/dev API calls in one owned process, create fresh plugin
instances for each configuration. Build resolution can retain production
NODE_ENV and plugin state. Set the intended development environment before dev
server creation and restore the caller's environment afterward; mode is not a
reset of NODE_ENV.

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
import assert from "node:assert/strict";
import { mergeConfig } from "vite";

const result = mergeConfig(
  { server: { port: 3000 }, define: { A: "1" } },
  { server: { strictPort: true }, define: { B: "2" } },
);

assert.equal(result.server.port, 3000);
assert.equal(result.server.strictPort, true);
assert.equal(result.define.A, "1");
assert.equal(result.define.B, "2");
```

## Oxc JavaScript/TypeScript transforms

Use `transformWithOxc` for standalone JavaScript or TypeScript transformation. It returns the transformed result and exposes warnings separately; the returned shape omits the Oxc `errors` field and includes `warnings`.

```ts pmcp-example
import assert from "node:assert/strict";
import { transformWithOxc } from "vite";

const result = await transformWithOxc(
  "const answer: number = 42",
  "example.ts",
);

assert.equal(typeof result.code, "string");
assert.equal(result.warnings.length, 0);
assert.match(result.code, /42/);
```

## CSS preprocessing

`preprocessCSS(code, filename, config)` handles CSS and supported preprocessor filenames including `.css`, `.scss`, `.sass`, `.less`, `.styl`, and `.stylus`. The corresponding preprocessor must be installed for preprocessor syntaxes. Supply a resolved Vite config.

```ts pmcp-example
import assert from "node:assert/strict";
import { preprocessCSS, resolveConfig } from "vite";

const config = await resolveConfig({}, "serve");
const result = await preprocessCSS(
  "body { color: red; }",
  "example.css",
  config,
);

assert.equal(typeof result.code, "string");
assert.match(result.code, /color:\s*red/);
```

## Path normalization

`normalizePath` is a standalone helper for normalizing plugin paths. Do not assume it converts backslashes in every environment; on the environment used here, a path that is already slash-normalized is preserved.

```ts pmcp-example
import assert from "node:assert/strict";
import { normalizePath } from "vite";

const normalized = normalizePath("src/components/Button.tsx");
assert.equal(normalized, "src/components/Button.tsx");
```

## Dev and preview servers

Create a development server with `createServer`, then call `listen()` yourself. The documented pattern is:

```ts
import { createServer } from "vite";

const server = await createServer({
  configFile: false,
  root: import.meta.dirname,
  server: { port: 1337 },
});
await server.listen();
server.printUrls();
server.bindCLIShortcuts({ print: true });
```

Use `server.close()` when the script is finished. The server API also provides request transformation, HTML transformation, SSR module loading, and module reloading.

Create a preview server with `preview(inlineConfig)`. Its documented pattern is:

```ts
import { preview } from "vite";

const previewServer = await preview({
  preview: { port: 8080, open: false },
});
previewServer.printUrls();
previewServer.bindCLIShortcuts({ print: true });
```

These APIs start HTTP servers and require an owning tool to manage listening, ports, and shutdown. They are described here but are not exercised by the standalone examples because those examples run without network access.

The separate API fixture uses a loopback server with server.watch set to null,
automatic dependency discovery disabled and an empty optimization include list
after framework configuration. It verifies HTML injection, TSX transformation
and actual server shutdown, not file-change HMR, dependency pre-bundling or
browser execution. Do not copy that optimizer configuration into a browser
application with CommonJS dependencies.
See [dependency optimization options](https://vite.dev/config/dep-optimization-options)
and [server file watching](https://vite.dev/config/server-options#server-watch).
The [plugin config hook](https://vite.dev/guide/api-plugin#config) can clear an
include list when ordinary merging preserves framework-injected dependencies.

## Production builds

Call `build(inlineConfig)` for a production build. The documented inline configuration can specify `root`, `base`, and `build.rolldownOptions`:

```ts
import path from "node:path";
import { build } from "vite";

await build({
  root: path.resolve(import.meta.dirname, "./project"),
  base: "/foo/",
  build: {
    rolldownOptions: {
      // Rolldown options
    },
  },
});
```

Catch the thrown error as a Vite 8 bundle error and inspect `.errors` when present. A real build also requires a project input, so it is not exercised by the standalone examples, which cannot use filesystem setup.

## Vite 8 configuration migration

Prefer Rolldown/Oxc names:

```ts
export default {
  build: { rolldownOptions: {} },
  worker: { rolldownOptions: {} },
};
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
import { defineConfig } from "vite";

export default defineConfig({
  // configuration
});
```

By default, Vite bundles a config with Rolldown into a temporary file; `--configLoader native` selects native loading.

## Not covered

This skill does not cover framework SSR integration, plugin authoring, the complete
ResolvedConfig or Rolldown type definitions, browser layout or React Compiler
adoption. Use the application's actual browser and framework checks for those
boundaries.

## Sources

- [Vite getting started](https://vite.dev/guide/)
- [Environment variables](https://vite.dev/guide/env-and-mode)
- [Production builds](https://vite.dev/guide/build)
- [JavaScript API](https://vite.dev/guide/api-javascript)
- [Vite 7 to 8 migration](https://vite.dev/guide/migration)
