---
name: zustand
description: Use Zustand ^5.0.0 for vanilla stores, React-bound stores, persistence, and Redux-style reducers. Covers documented v5 APIs, standalone examples, and migration traps such as stable selectors, replacement updates, and changed persistence behavior.
---

Verified against zustand@5.0.15 on 2026-09-08. 3 of 3 examples executed.

# zustand ^5.0.0

## Core API

Use named exports. Zustand v5 drops default exports.

- `zustand`: `create`, `useStore`
- `zustand/vanilla`: `createStore`
- `zustand/middleware`: `persist`, `createJSONStorage`, `redux`, and other documented middleware such as `devtools`, `immer`, `combine`, and `subscribeWithSelector`

`create<T>()(stateCreator)` returns a React-bound store hook. The hook has attached `setState`, `getState`, `getInitialState`, and `subscribe` APIs. The state creator receives `set` and `get`; ordinary `set` calls merge partial updates.

A React runtime is required to import and use the `zustand` entry point. A plain standalone script without React cannot execute a `create` example. Use `createStore` from `zustand/vanilla` for code that does not run inside React.

`createStore<T>()(stateCreator)` returns a vanilla `StoreApi<T>` with `getState`, `setState`, `getInitialState`, and `subscribe`.

```ts pmcp-example
import { strict as assert } from 'node:assert'
import { createStore } from 'zustand/vanilla'

const store = createStore<{ bears: number; add: () => void }>()((set) => ({
  bears: 0,
  add: () => set((state) => ({ bears: state.bears + 1 })),
}))

store.getState().add()
assert.equal(store.getState().bears, 1)
assert.equal(store.getInitialState().bears, 0)

let observed = -1
const unsubscribe = store.subscribe((state) => {
  observed = state.bears
})
store.setState({ bears: 3 })
assert.equal(observed, 3)
unsubscribe()
```

A vanilla store can be bound to React with `useStore`, but that binding requires a React application/runtime and is not demonstrated in a plain script.

## Persistence

Wrap a state creator with `persist`. The `name` option is required. The default storage is JSON-wrapped `localStorage`; in non-browser or standalone code, provide a storage explicitly with `createJSONStorage`.

In v5, persist does not store the initial state during store creation. If the initial state must be persisted immediately, explicitly call `setState` after creating the store.

```ts pmcp-example
import { strict as assert } from 'node:assert'
import { createStore } from 'zustand/vanilla'
import { createJSONStorage, persist } from 'zustand/middleware'

const values = new Map<string, string>()
const storage = createJSONStorage(() => ({
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => { values.set(key, value) },
  removeItem: (key) => { values.delete(key) },
}))

const store = createStore(
  persist(
    (set) => ({ count: 0, increment: () => set((state) => ({ count: state.count + 1 })) }),
    { name: 'counter', storage },
  ),
)

assert.equal(values.has('counter'), false)
store.getState().increment()
assert.equal(store.getState().count, 1)
assert.equal(values.has('counter'), true)
```

`persist` modifies the state creator's wrapped `set` and `get`. Do not assume that middleware changes every separately exposed vanilla `getState` or `setState` behavior in the same way.

## Redux middleware

`redux(reducer, initialState)` adds `dispatch` to the state. Actions must have a string `type`. The reducer returns the next state value.

```ts pmcp-example
import { strict as assert } from 'node:assert'
import { createStore } from 'zustand/vanilla'
import { redux } from 'zustand/middleware'

const store = createStore(
  redux(
    (state: { count: number }, action: { type: string }) =>
      action.type === 'inc' ? { count: state.count + 1 } : state,
    { count: 0 },
  ),
)

store.getState().dispatch({ type: 'inc' })
assert.equal(store.getState().count, 1)
```

## v5 migration traps

### Do not use the v4 equality-function shape with `create`

In v5, `create` does not accept a custom equality function as a second hook argument. For equality-function usage, use `createWithEqualityFn` from `zustand/traditional` and install the `use-sync-external-store` peer dependency. Alternatively use `useShallow` from `zustand/shallow`.

### Keep selector results stable

Selectors that create a new array or object on every call can cause infinite loops in v5. Use `useShallow` for shallowly compared compound selections, or return stable values. Avoid a fresh fallback such as `state.action ?? (() => {})`; define a stable fallback instead.

### Replacement updates require complete state

`setState(value, true)` replaces the entire state rather than merging it. The replacement must contain every required state field. For partial updates, omit the second argument or use the default merge behavior.

### Other v5 compatibility changes

- React 18 is the minimum React version documented for v5.
- TypeScript 4.5 is the minimum documented version.
- `use-sync-external-store` is a peer dependency for `zustand/traditional`.
- UMD/SystemJS and ES5 support were dropped.
- `createContext` was removed from `zustand/context`.
- Persist behavior changed: initial state is not automatically stored during store creation.
- Default exports and deprecated features were dropped.

## What this skill does not cover

This skill does not cover React component rendering, because the React-bound `zustand` entry point cannot run in the standalone example environment without React. It also does not cover framework integration, hydration, a runnable `traditional` example, detailed options for every middleware, Redux DevTools setup, or browser-specific storage behavior. `devtools` additionally requires the Redux DevTools Chrome extension. Those areas require runtime or configuration context not covered by the supplied research.
