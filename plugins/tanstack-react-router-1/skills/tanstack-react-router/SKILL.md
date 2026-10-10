---
name: tanstack-react-router
description: Wire TanStack React Router 1.x into React with inferred route types, validated URL search, loader dependencies, and context-based guards. Prefer the dependency's shipped router-core skills for detailed domain guidance.
compatibility: TanStack React Router 1.170.33, its resolved router-core, and matched React and React DOM releases. File-based generation needs the project's router plugin.
---

# TanStack React Router 1.x integration

`@tanstack/react-router` is separate from `react-router` and `react-router-dom`.
Use the installed package and its resolved core version; do not assume their
minor versions match. A package's shipped skills are better evidence for its
version than copying instructions for the current upstream branch.

## Keep the route tree and types connected

Create the router once and register its inferred type. Mount `RouterProvider`
within the React providers its route context depends on.

```tsx
const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

function App() {
  return <RouterProvider router={router} />;
}
```

Keep `Link`, `navigate`, params and search inferred from that registered tree.
Casting away errors can hide a nonexistent route or a missing path parameter.
Use a route's own hooks or a precise `from` when narrowing reusable hooks.

For file routing, the existing router plugin generates `routeTree.gen.ts` and
route identifiers. Keep it before the React plugin when that is the documented
plugin order for the installed versions. Do not hand-edit generated route trees
to make an invalid route string compile. A code-based fixture does not verify
file generation or automatic splitting.

## Validate search and connect it to loaders

Search values originate in an untrusted URL even when JSON parsing succeeds.
Return a concrete shape from `validateSearch`. Choose a fallback or an explicit
validation error according to the application; coercion alone can produce NaN.

```ts
const itemRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "items/$itemId",
  validateSearch(raw) {
    const page = Number(raw.page);
    if (!Number.isInteger(page) || page < 1) return { page: 1 };
    return { page };
  },
  loaderDeps: ({ search }) => ({ page: search.page }),
  loader: ({ params, deps, context }) =>
    context.readItem(params.itemId, deps.page),
});
```

Declare changing search values in `loaderDeps` so cached loader identity follows
the inputs that matter. Read results with the matched route's `useLoaderData`.
Do not use React hooks inside `loader` or `beforeLoad`; pass services and auth
state through a typed root context instead.

## Guard navigation without pretending it is server authorization

Use `beforeLoad` and `redirect` for client navigation decisions. Inject current
auth through the surrounding provider/context and invalidate when appropriate;
recreating the router on every auth change discards its caches.

Loaders can execute on the client and, with SSR, on both sides. They are not
automatically server-only functions. Backend authorization still belongs at
the backend boundary. Memory-history tests can verify matching, search, loading
and redirect objects without browser globals; they do not verify hydration,
browser interaction, or a complete SSR deployment.

## Reuse the relevant upstream skill

Installed router-core packages can ship `skills/router-core/SKILL.md` and focused
subskills for search, loading, navigation and guards. Discover the installed
contents before duplicating them. In the examined 1.170.33 React package, those
instructions ship with its core dependency rather than the React package itself.

Do not install a second skill runner, modify project permissions, or enable
agent hooks merely to read that static guidance.

## Sources

- [Official router-core skill](https://github.com/TanStack/router/blob/f6d21de12b69781738c96cfa3b468fa65294e0ef/packages/router-core/skills/router-core/SKILL.md)
- [Official React binding skill](https://github.com/TanStack/router/blob/f6d21de12b69781738c96cfa3b468fa65294e0ef/packages/react-router/skills/react-router/SKILL.md)
- [Search parameter guidance](https://github.com/TanStack/router/blob/f6d21de12b69781738c96cfa3b468fa65294e0ef/docs/router/guide/search-params.md)
- [Loader and cache guidance](https://github.com/TanStack/router/blob/f6d21de12b69781738c96cfa3b468fa65294e0ef/docs/router/guide/data-loading.md)
