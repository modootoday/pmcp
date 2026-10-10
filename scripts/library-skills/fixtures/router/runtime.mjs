import assert from "node:assert/strict";

export async function verifyRouting(require) {
  const {
    createRootRouteWithContext,
    createRoute,
    createRouter,
    createMemoryHistory,
    redirect,
  } = require("@tanstack/react-router");
  const React = require("react");
  const { renderToString } = require("react-dom/server");
  const { RouterProvider, Outlet } = require("@tanstack/react-router");
  let loads = 0;
  let redirectDecision;
  const root = createRootRouteWithContext()({
    component: () => React.createElement(Outlet),
  });
  let items;
  items = createRoute({
    getParentRoute: () => root,
    path: "items/$itemId",
    validateSearch(raw) {
      const page = Number(raw.page);
      if (!Number.isInteger(page) || page < 1) return { page: 1 };
      return { page };
    },
    loaderDeps: ({ search }) => ({ page: search.page }),
    async loader({ params, deps, context }) {
      loads += 1;
      return {
        id: params.itemId,
        page: deps.page,
        label: await context.readItem(params.itemId),
      };
    },
    component() {
      const data = items.useLoaderData();
      return React.createElement("h1", null, `${data.label}:${data.page}`);
    },
  });
  const login = createRoute({
    getParentRoute: () => root,
    path: "login",
    validateSearch: (raw) => ({
      next: typeof raw.next === "string" ? raw.next : "/",
    }),
  });
  const privateRoute = createRoute({
    getParentRoute: () => root,
    path: "private",
    beforeLoad({ context }) {
      if (context.authenticated) return;
      redirectDecision = redirect({
        to: "/login",
        search: { next: "/private" },
      });
      throw redirectDecision;
    },
  });
  const routeTree = root.addChildren([items, login, privateRoute]);
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/items/42?page=2"] }),
    context: { readItem: async (id) => `Item ${id}`, authenticated: false },
    isServer: true,
  });
  try {
    await router.load();
    const match = router.state.matches.find(
      (value) => value.routeId === items.id,
    );
    assert.deepEqual(match?.loaderData, {
      id: "42",
      page: 2,
      label: "Item 42",
    });
    assert.match(
      renderToString(React.createElement(RouterProvider, { router })),
      /Item 42:2/u,
    );
    router.history.push("/items/42?page=3");
    await router.load();
    const fallback = router.state.matches.find(
      (value) => value.routeId === items.id,
    );
    assert.equal(fallback?.loaderData.page, 3);
    assert.deepEqual(items.options.validateSearch({ page: "bad" }), {
      page: 1,
    });
    assert.ok(loads >= 2);
    router.history.push("/private");
    await router.load();
    assert.equal(redirectDecision?.options.to, "/login");
    assert.equal(redirectDecision?.options.search.next, "/private");
    return [
      "memory history path/search loader dependencies",
      "React RouterProvider and typed route loader hook render",
      "dependency-driven reload",
      "invalid search validator fallback",
      "context guard emits login redirect",
    ];
  } finally {
    router.history.destroy();
  }
}
