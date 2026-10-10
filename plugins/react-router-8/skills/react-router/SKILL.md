---
name: react-router
description: Use react-router ^8.0.0 APIs correctly, including v8 import boundaries, pure path helpers, and the parts that require a React or framework runtime.
---

Verified against react-router@8.3.1 on 2026-09-08. 2 of 2 examples executed.

# react-router ^8.0.0

## Version and module boundary

- The v8 line is ESM-only and requires Node 22.22.0+, React 19.2.7+, and Vite 7+.
- Import general routing APIs from `react-router`:

```ts
import { Link, Route, createBrowserRouter } from "react-router";
```

- Import DOM-specific `RouterProvider` and `HydratedRouter` from `react-router/dom`:

```ts
import { RouterProvider, HydratedRouter } from "react-router/dom";
```

- Do not use the older v7 compatibility shape with `react-router-dom`; v8 removes `react-router-dom`.
- `createBrowserRouter(routes, opts?)` creates a data router backed by `history.pushState` and `history.replaceState`. Its result is passed to `RouterProvider`.

## Pure path helpers

### `generatePath`

`generatePath(originalPath, params?)` substitutes route parameters and URL-encodes parameter values.

```ts
import { generatePath } from "react-router";

const userPath = generatePath("/users/:id", { id: "123" });
const filePath = generatePath("/files/:name", { name: "a b" });
```

`userPath` is `/users/123`; `filePath` is `/files/a%20b`.

```ts pmcp-example
import assert from "node:assert/strict";
import { generatePath } from "react-router";

assert.equal(generatePath("/users/:id", { id: "123" }), "/users/123");
assert.equal(generatePath("/files/:name", { name: "a b" }), "/files/a%20b");
```

### `matchPath`

`matchPath(pattern, pathname)` returns a path match or `null`.

When the pattern is a string, its defaults are `caseSensitive: false` and `end: true`. The result contains the parsed route parameters.

```ts pmcp-example
import assert from "node:assert/strict";
import { matchPath } from "react-router";

const match = matchPath("/users/:id", "/USERS/123");
assert.ok(match);
assert.equal(match.params.id, "123");

assert.equal(matchPath("/users/:id", "/users/123/settings"), null);
```

## React-bound APIs

### `useRoutes`

`useRoutes(routes, locationArg?)` is a React hook that renders the element matched by a route-object tree. It must be called from a React component, not from a plain script or at module scope.

The route tree can contain nested children:

```tsx
function App() {
  return useRoutes([
    {
      path: "/",
      element: <Dashboard />,
      children: [
        { path: "messages", element: <DashboardMessages /> },
        { path: "tasks", element: <DashboardTasks /> },
      ],
    },
    { path: "team", element: <AboutPage /> },
  ]);
}
```

No standalone `ts pmcp-example` is provided for this hook because executing it requires a React render environment, which a direct `bun example.ts` process does not provide.

### `createBrowserRouter`

`createBrowserRouter` is a DOM data-router API. Create the router from route objects and pass it to `RouterProvider` imported from `react-router/dom` in a browser application. A direct script has no browser history or DOM setup, so this API is exercised through the application/tool runtime rather than a standalone example.

## v8 migration traps

- Do not import `RouterProvider` or `HydratedRouter` from `react-router`; use `react-router/dom`.
- Do not import from `react-router-dom`; it was retained as a v7 re-export but is removed in v8.
- The deprecated `meta` data is removed. Use `loaderData` in `MetaArgs`, `MetaMatch`, `Route.ComponentProps.matches`, and `UIMatch`.
- Middleware is always enabled. Loader, action, and middleware `context` is always a `RouterContextProvider`; a custom `getLoadContext` must return that type rather than a plain object.
- `future.v8_*` flags are removed or promoted to defaults. In particular, `future.v8_splitRouteModules` is replaced by top-level `splitRouteModules`, whose documented values include `false` and `"enforce"`; its default is `true`.
- `hasErrorBoundary` is no longer accepted on route objects, JSX route props, or lazy route definitions.

## Framework and server boundaries

Framework Mode depends on `@react-router/dev`'s Vite plugin for type-safe route modules, code splitting, SPA/SSR/SSG, and generated route types. Its setup is CLI/build-oriented rather than a self-contained package API.

`ServerRouter` is a framework-entry API. It requires the generated/server entry context and is not a standalone helper for a plain script.

## Not covered

This skill does not cover the complete route-object type surface, loaders and actions, middleware implementation, `RouterProvider` options, framework route-file conventions, generated route types, SSR/SSG setup, or the `ServerRouter` entry context. The available research also does not establish a standalone Node-only data-router setup.
