---
name: react-is
description: Use react-is 19 to identify React element brands and validate component types. Covers the React 19 export surface, the removal of React 18 async/concurrent aliases, and standalone checks that run without JSX, React, a DOM, or a test runner.
---

Verified against react-is@19.2.8 on 2026-09-08. 2 of 2 examples executed.

# react-is 19

`react-is` provides brand checks for arbitrary values and React element types. Import the package namespace:

```ts
import * as ReactIs from "react-is";
```

## React 19 exports

React 19 exposes these validation functions:

- `isValidElementType`
- `isElement`
- `isFragment`
- `isPortal`
- `isStrictMode`
- `isContextConsumer`
- `isContextProvider`
- `isForwardRef`
- `isLazy`
- `isMemo`
- `isProfiler`
- `isSuspense`
- `isSuspenseList`

It also exposes `typeOf`, which returns the React type brand for a React-created value, and these type-brand constants:

- `Element`
- `Fragment`
- `Portal`
- `StrictMode`
- `ContextConsumer`
- `ContextProvider`
- `ForwardRef`
- `Lazy`
- `Memo`
- `Profiler`
- `Suspense`
- `SuspenseList`

## Validate component types

`isValidElementType` accepts a host element name such as `"div"` and component functions. It is a check for a value that React can use as an element type, not a check that a value is already an element.

```ts pmcp-example
import * as assert from "node:assert/strict";
import * as ReactIs from "react-is";

function Component() {
  return null;
}

assert.equal(ReactIs.isValidElementType("div"), true);
assert.equal(ReactIs.isValidElementType(Component), true);
assert.equal(ReactIs.isValidElementType(null), false);
assert.equal(ReactIs.isValidElementType({}), false);
```

## Check arbitrary values without React or JSX

All element predicates safely reject unrelated values. This makes them usable in a plain script, although a positive result generally requires a value created by React or ReactDOM.

```ts pmcp-example
import * as assert from "node:assert/strict";
import * as ReactIs from "react-is";

const value = {};

assert.equal(ReactIs.isElement(value), false);
assert.equal(ReactIs.isFragment(value), false);
assert.equal(ReactIs.isPortal(value), false);
assert.equal(ReactIs.isStrictMode(value), false);
assert.equal(ReactIs.isContextConsumer(value), false);
assert.equal(ReactIs.isContextProvider(value), false);
assert.equal(ReactIs.isForwardRef(value), false);
assert.equal(ReactIs.isLazy(value), false);
assert.equal(ReactIs.isMemo(value), false);
assert.equal(ReactIs.isProfiler(value), false);
assert.equal(ReactIs.isSuspense(value), false);
assert.equal(ReactIs.isSuspenseList(value), false);
```

## React-created values

With React available, use `typeOf` and the predicates against values created by React:

- `typeOf(<div />) === Element` and `isElement(<div />)` identify an element.
- `typeOf(<></>) === Fragment` and `isFragment(<></>)` identify a fragment.
- `isStrictMode(<React.StrictMode />)` and `typeOf(...) === StrictMode` identify strict mode.
- `isContextConsumer(<ThemeContext.Consumer />)` and `isContextProvider(<ThemeContext.Provider />)` identify context values. Their brands are `ContextConsumer` and `ContextProvider`.

These forms require React and JSX (or equivalent calls to React APIs), so they are not standalone `bun example.ts` examples under this skill's execution constraints.

## Portals

Portal checks require both ReactDOM and a DOM container:

```js
const div = document.createElement("div");
const portal = ReactDOM.createPortal(<div />, div);
ReactIs.isPortal(portal); // true
ReactIs.typeOf(portal) === ReactIs.Portal; // true
```

This requires a browser-like `document`, ReactDOM, and a React-created element; it cannot run in the standalone no-DOM example environment.

## React 18 compatibility trap

Do not copy the older React 18 API shape into React 19 code:

- React 19 does not export `isAsyncMode` or `isConcurrentMode`.
- The corresponding `AsyncMode` and `ConcurrentMode` aliases from the older implementation are not part of the React 19 stable export list.
- React 18 documentation showed `isValidElementType(React.createFactory("div"))`; that example is not included in the React 19 documentation.

React 19 also has feature-aware handling for context consumer and provider brands. Use the exported `ContextConsumer` and `ContextProvider` constants and the matching predicates rather than assuming the older internal context symbols.

## TypeScript

The researched package metadata identifies `@types/react-is` as the separately published TypeScript declaration package. The package itself is not documented in the researched sources as shipping TypeScript declarations.

## Not covered

This skill does not cover React rendering, JSX compilation, ReactDOM setup, browser DOM setup, creation of portals, creation of contexts, or construction of forward-ref, lazy, memo, profiler, suspense, or suspense-list values. It also does not cover undocumented internal symbol shapes, bundler configuration, or the separately published declaration package beyond noting its existence.
