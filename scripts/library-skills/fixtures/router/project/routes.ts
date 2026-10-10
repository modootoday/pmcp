import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  createMemoryHistory,
} from "@tanstack/react-router";

const rootRoute = createRootRouteWithContext<{
  readItem: (id: string) => Promise<{ id: string }>;
}>()();
const itemRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "items/$itemId",
  validateSearch: (raw: Record<string, unknown>) => ({
    page: Number(raw.page) || 1,
  }),
  loaderDeps: ({ search }) => ({ page: search.page }),
  loader: ({ params, deps, context }) =>
    context.readItem(`${params.itemId}:${deps.page}`),
});
export const router = createRouter({
  routeTree: rootRoute.addChildren([itemRoute]),
  history: createMemoryHistory(),
  context: { readItem: async (id) => ({ id }) },
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

void router.navigate({
  to: "/items/$itemId",
  params: { itemId: "42" },
  search: { page: 2 },
});
