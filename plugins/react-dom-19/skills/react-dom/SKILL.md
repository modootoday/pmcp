---
name: react-dom
description: Use react-dom ^19.0.0 with React 19 root, server-rendering, portal, scheduling, form-status, and resource APIs. Avoid removed React 18-era entry points and distinguish browser-only APIs from standalone server APIs.
---

The two standalone server examples were verified against react-dom@19.2.8 on
2026-09-07. Client lifecycle and hydration verification use the separate DOM
fixture and must not be counted as DOM-free examples.

# react-dom ^19.0.0

## Scope

`react-dom` is for web applications running in a browser DOM. It is not supported for React Native. The documented entry points include `react-dom`, `react-dom/client`, `react-dom/server`, and static APIs under `react-dom/static`.

## React 19 root APIs

Import client root APIs from `react-dom/client`, not from `react-dom`:

```js
import { createRoot } from 'react-dom/client';

const root = createRoot(clientContainer);
root.render(reactNode);
```

Use `createRoot` for client rendering and `hydrateRoot` when attaching React to existing server-rendered markup. Keep the returned root if the application needs to render again or unmount later.

The hydration container already contains matching server HTML. Do not immediately render again or unmount while hydration is starting:

```js
import { hydrateRoot } from "react-dom/client";

const hydratedRoot = hydrateRoot(serverContainer, matchingReactNode);
```

Keep react and react-dom on matching versions. Use a stable container owned by
React, and call root.unmount() before an external owner removes that container.
Create one root per independently managed React tree rather than a new root for
every state update.

```tsx
import { createRoot } from "react-dom/client";
import { App } from "./app";

const container = document.getElementById("app");
if (!container) throw new Error("Missing application container");
const root = createRoot(container);
root.render(<App />);

export function dispose() {
  root.unmount();
}
```

hydrateRoot expects the initial client tree to match the server HTML. Resolve
differences in data, locale, time, random values and invalid HTML nesting rather
than routinely using suppressHydrationWarning. Browser-only content can render
after an effect when that is the chosen product behavior. Capture recoverable
hydration errors with onRecoverableError; successful recovery is still evidence
of a mismatch. Avoid calling root.render before hydration finishes because it can
discard the server HTML and switch the whole root to client rendering.

### Common outdated shapes

These React 18-era APIs were removed in React 19:

- `render` — use `createRoot(domNode).render(reactNode)`.
- `hydrate` — use `hydrateRoot(domNode, reactNode)`.
- `unmountComponentAtNode` — use the root's `unmount()` method.
- `findDOMNode`.
- `renderToNodeStream`.
- `renderToStaticNodeStream`.

Do not import those removed APIs from `react-dom`.

## Server rendering

Import the documented server APIs from `react-dom/server`:

```js
import { renderToString, renderToStaticMarkup } from 'react-dom/server';

renderToString(reactNode);
renderToStaticMarkup(reactNode);
```

`renderToString` and `renderToStaticMarkup` can be used from a plain script without a browser DOM. The server entry point also documents `renderToReadableStream`, `resume`, `renderToPipeableStream`, and `resumeToPipeableStream`.

```ts pmcp-example
import assert from "node:assert/strict";
import React from "react";
import { renderToString } from "react-dom/server";

const markup = renderToString(
  React.createElement("main", null, React.createElement("h1", null, "Hello")),
);

assert.match(markup, /<main>/);
assert.match(markup, /<h1>Hello<\/h1>/);
```

```ts pmcp-example
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const markup = renderToStaticMarkup(
  React.createElement("button", { type: "button" }, "Save"),
);

assert.equal(markup, '<button type="button">Save</button>');
```

## Browser APIs from `react-dom`

The main entry point documents these APIs:

```js
import { createPortal, flushSync, preconnect } from 'react-dom';

createPortal(children, domNode);
flushSync(callback);
preconnect(href);
```

Additional resource APIs are `prefetchDNS(href)`, `preload(href, options)`, `preloadModule(href, options?)`, `preinit(href, options?)`, and `preinitModule(href, options?)`.

These APIs target the browser DOM or browser resource-loading behavior and cannot
be exercised by the standalone server examples in this skill. A DOM simulator
can check element behavior but cannot establish browser resource loading or
layout. Frameworks may already handle resource loading, so the package APIs alone
do not replace framework integration. Reserve flushSync for integration points
that require a synchronous DOM update; it can force pending work and affect
Suspense behavior.

## Forms and React 19 additions

`useFormStatus` is imported from `react-dom` and exposes form submission status such as `pending`:

```jsx
import { useFormStatus } from "react-dom";

function DesignButton() {
  const { pending } = useFormStatus();
  return <button type="submit" disabled={pending} />;
}
```

React 19 form actions can be supplied with the `action` prop:

Pass the action function to `<form action={actionFunction}>` and render its fields inside that form.

Successful Form Actions reset uncontrolled forms. `requestFormReset` performs a manual reset. These behaviors require the React/browser form runtime and are not demonstrated in a DOM-free script.

## Features requiring tooling or framework integration

- Server Actions using `"use server"` require a framework or build system to create server references and route requests. The directive is not a Server Component marker.
- React Server Components bundler/framework implementation APIs do not follow semver; pin React or use a Canary release when implementing that infrastructure.
- `use` cannot consume promises created during render. Promises must come from a Suspense-compatible library or framework.
- `prerender` and `prerenderToNodeStream` wait for data and produce static output; they do not stream content as it loads.

## Does not cover

This skill does not cover framework-specific integration, Server Actions routing,
Server Components bundler implementation, streaming server API usage or the
react-dom/static API details. Verify browser rendering with the application's
actual browser test environment; the fixture's DOM simulation checks roots,
cleanup, form actions and matching-markup hydration without proving layout or
framework behavior.

## Sources

- [React DOM APIs](https://react.dev/reference/react-dom)
- [Client root lifecycle](https://react.dev/reference/react-dom/client/createRoot)
- [Hydration requirements](https://react.dev/reference/react-dom/client/hydrateRoot)
- [Resource hints](https://react.dev/reference/react-dom/preconnect)
- [React 19 release](https://react.dev/blog/2024/12/05/react-19)
