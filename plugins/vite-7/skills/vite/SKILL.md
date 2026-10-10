---
name: vite
description: Develop and diagnose Vite 7 applications, including React integration, environment variables, asset base paths, production builds and development server lifecycle. Keep Vite 7's Rollup/esbuild configuration separate from Vite 8's Rolldown/Oxc configuration.
---

# Vite 7 application workflows

Read the installed Vite, Node and plugin versions first. Vite 7 requires Node
20.19+ or 22.12+. The fixture uses Vite 7.3.6 with @vitejs/plugin-react 5.2.0;
plugin-react 6 requires Vite 8 and must not be added to a Vite 7 configuration.

## Configure the existing application

Preserve the project's framework plugin, entry HTML and package manager. Vite
transforms TypeScript syntax but does not perform application typechecking; run
the project's TypeScript check separately.

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "/app/",
  build: { target: "es2022" },
});
```

Use base for the deployment prefix and verify the built HTML's asset references.
Do not fix a subpath deployment by hardcoding asset paths throughout components.
Import assets from application modules when they belong to the build graph; use
public for files that need their original filename and are copied without bundling.

## Environment and security boundaries

Client code reads import.meta.env. VITE_-prefixed variables are exposed to client
code and must contain public data only. Values are strings except Vite's built-in
boolean properties. Changing envPrefix or define can expose additional values;
do not serialize process.env into a browser bundle.

Mode selects the .env files, while NODE_ENV has a different responsibility.
Restart the dev server after changing environment files. Test the selected mode
and production artifact instead of relying on a value seen in a development tab.

## Build, preview and development lifecycle

Use the existing scripts for vite, vite build and vite preview. A preview server
checks the built application and is not the production web server. Validate the
application's runtime through its actual browser test runner when behavior,
accessibility or CSS layout changes.

Programmatic integration must own shutdown:

```ts
import { createServer } from "vite";

const server = await createServer({
  server: { host: "127.0.0.1", port: 0, open: false },
});

try {
  await server.listen();
  await server.transformRequest("/src/main.tsx");
} finally {
  await server.close();
}
```

Use transformIndexHtml in a custom HTML-serving integration so plugin-injected
scripts, including React's Fast Refresh initialization, are present. Serving the
original index.html unchanged bypasses this integration.

When running build and dev APIs in one owned process, instantiate plugins
separately for each configuration. Build resolution can set NODE_ENV to production
and plugins can retain command-specific state. Restore the intended development
environment explicitly before creating the dev server and restore the caller's
environment afterward; changing mode alone does not reset NODE_ENV.

## Diagnose by stage

- Dev succeeds but build fails: inspect build inputs, import resolution, target
  and Rollup plugin behavior. Do not assume the development dependency optimizer
  establishes production compatibility.
- Build succeeds but deployment loses assets: check base, server routing and the
  produced asset URLs before changing component paths.
- JSX appears untransformed or Refresh fails: inspect the React plugin, file
  include filters and transformed HTML. Keep component exports compatible with
  Fast Refresh instead of disabling updates globally.
- Types fail but the bundle works: fix the TypeScript project and declaration
  boundaries; Vite does not replace the compiler check.

Vite 7 uses build.rollupOptions and esbuild-oriented transformation settings.
Keep Vite 8 migration choices separate. The fixture checks a production build,
public-variable replacement, base-aware assets, development TSX transformation,
Refresh HTML injection and shutdown. It does not prove browser rendering or SSR.
The API fixture disables file watching with server.watch set to null, disables
dependency discovery and uses an empty optimization include list after framework
configuration. It does not validate file-change HMR or dependency pre-bundling,
or claim that these settings are suitable for a browser application. CommonJS
dependencies normally need optimization during development.

## Sources

- [Vite 7 getting started](https://v7.vite.dev/guide/)
- [Vite 7 environment variables](https://v7.vite.dev/guide/env-and-mode)
- [Vite 7 production builds](https://v7.vite.dev/guide/build)
- [Vite 7 JavaScript API](https://v7.vite.dev/guide/api-javascript)
- [Dependency optimization options](https://vite.dev/config/dep-optimization-options)
- [Server file watching](https://vite.dev/config/server-options#server-watch)
- [Plugin configuration hooks](https://vite.dev/guide/api-plugin#config)
- [Vite React plugin](https://github.com/vitejs/vite-plugin-react/tree/main/packages/plugin-react)
