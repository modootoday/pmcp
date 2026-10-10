---
name: react-dom
description: Use react-dom ^19.0.0 with React 19 root, server-rendering, portal, scheduling, form-status, and resource APIs. Avoid removed React 18-era entry points and distinguish browser-only APIs from standalone server APIs.
---

Verified against react-dom@19.2.8 on 2026-09-07. 2 of 2 examples executed.

# react-dom ^19.0.0

## Scope

`react-dom` is for web applications running in a browser DOM. It is not supported for React Native. The documented entry points include `react-dom`, `react-dom/client`, `react-dom/server`, and static APIs under `react-dom/static`.

## React 19 root APIs

Import client root APIs from `react-dom/client`, not from `react-dom`:

```js
import { createRoot, hydrateRoot } from 'react-dom/client';

const root = createRoot(domNode, options?);
root.render(reactNode);
root.unmount();

const hydratedRoot = hydrateRoot(domNode, reactNode, options?);
hydratedRoot.render(reactNode);
hydratedRoot.unmount();
```

Use `createRoot` for client rendering and `hydrateRoot` when attaching React to existing server-rendered markup. Keep the returned root if the application needs to render again or unmount later.

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

renderToString(reactNode, options?);
renderToStaticMarkup(reactNode, options?);
```

`renderToString` and `renderToStaticMarkup` can be used from a plain script without a browser DOM. The server entry point also documents `renderToReadableStream`, `resume`, `renderToPipeableStream`, and `resumeToPipeableStream`.

```ts pmcp-example
import assert from 'node:assert/strict';
import React from 'react';
import { renderToString } from 'react-dom/server';

const markup = renderToString(
  React.createElement('main', null, React.createElement('h1', null, 'Hello')),
);

assert.match(markup, /<main>/);
assert.match(markup, /<h1>Hello<\/h1>/);
```

```ts pmcp-example
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const markup = renderToStaticMarkup(
  React.createElement('button', { type: 'button' }, 'Save'),
);

assert.equal(markup, '<button type="button">Save</button>');
```

## Browser APIs from `react-dom`

The main entry point documents these APIs:

```js
import { createPortal, flushSync, preconnect } from 'react-dom';

createPortal(children, domNode, key?);
flushSync(callback);
preconnect(href);
```

Additional resource APIs are `prefetchDNS(href)`, `preload(href, options)`, `preloadModule(href, options?)`, `preinit(href, options?)`, and `preinitModule(href, options?)`.

These APIs target the browser DOM or browser resource-loading behavior and cannot be exercised by the standalone Bun examples in this skill, which run without a DOM, framework, network, or filesystem. Use them in browser application code. Frameworks may already handle resource loading, so the package APIs alone do not replace framework integration.

## Forms and React 19 additions

`useFormStatus` is imported from `react-dom` and exposes form submission status such as `pending`:

```js
import { useFormStatus } from 'react-dom';

function DesignButton() {
  const { pending } = useFormStatus();
  return <button type="submit" disabled={pending} />;
}
```

React 19 form actions can be supplied with the `action` prop:

```jsx
<form action={actionFunction}>
```

Successful Form Actions reset uncontrolled forms. `requestFormReset` performs a manual reset. These behaviors require the React/browser form runtime and are not demonstrated in a DOM-free script.

## Features requiring tooling or framework integration

- Server Actions using `"use server"` require a framework or build system to create server references and route requests. The directive is not a Server Component marker.
- React Server Components bundler/framework implementation APIs do not follow semver; pin React or use a Canary release when implementing that infrastructure.
- `use` cannot consume promises created during render. Promises must come from a Suspense-compatible library or framework.
- `prerender` and `prerenderToNodeStream` wait for data and produce static output; they do not stream content as it loads.

## Does not cover

This skill does not cover browser DOM setup, framework-specific integration, Server Actions routing, Server Components bundler implementation, Suspense-compatible data libraries, detailed root options, streaming server API usage, or the `react-dom/static` API details. Those topics were not specified by the available research or require an environment beyond a standalone Bun script.

## Sources

- https://react.dev/reference/react-dom?utm_source=openai
- https://react.dev/reference/react-dom/preconnect?utm_source=openai
- https://react.dev/blog/2024/12/05/react-19?utm_source=openai
