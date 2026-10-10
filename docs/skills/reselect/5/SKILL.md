---
name: reselect
description: Use Reselect ^5.0.0 to build memoized selectors, customize memoization, compose structured results, and account for v5 defaults and API changes.
---

Verified against reselect@5.3.0 on 2026-09-08. 6 of 6 examples executed.

# reselect ^5.0.0

## What this package does

`reselect` is a selector library. Import its functions directly from the package; ordinary use does not require a runner, CLI, build step, framework global, or test runner.

The main exports documented for this version range are:

- `createSelector`
- `createSelectorCreator`
- `createStructuredSelector`
- `lruMemoize`
- `weakMapMemoize`

## `createSelector`

Pass input selectors either as one array or as separate arguments, followed by a result function and, optionally, an options object. The returned selector is memoized.

In v5, `weakMapMemoize` is the default for both memoization levels. This differs from v4, where `lruMemoize` (formerly `defaultMemoize`) was the default with a cache size of `1`.

```ts pmcp-example
import assert from 'node:assert/strict'
import { createSelector } from 'reselect'

type State = {
  todos: Array<{ id: number; category: string }>
}

const selectTodosByCategory = createSelector(
  [
    (state: State) => state.todos,
    (_state: State, category: string) => category
  ],
  (todos, category) => todos.filter(todo => todo.category === category)
)

const todos = [
  { id: 1, category: 'work' },
  { id: 2, category: 'home' },
  { id: 3, category: 'work' }
]
const state = { todos }

const first = selectTodosByCategory(state, 'work')
const second = selectTodosByCategory(state, 'work')

assert.deepEqual(first, [
  { id: 1, category: 'work' },
  { id: 3, category: 'work' }
])
assert.strictEqual(first, second)
```

Use an input selector for every value needed by the result function. Input selectors receive the same arguments as the resulting selector, so additional parameters can be selected without the removed v4-specific `ParametricSelector` types.

The selector exposes memoization-related fields including `dependencyRecomputations`, `resetDependencyRecomputations`, `memoize`, and `argsMemoize`.

## Per-selector memoization

Pass `memoize` and `memoizeOptions` in the third argument to configure one selector. `lruMemoize` supports configurable cache and equality behavior, including `resultEqualityCheck`.

```ts pmcp-example
import assert from 'node:assert/strict'
import { createSelector, lruMemoize } from 'reselect'

type State = { todos: Array<{ id: number; title: string }> }

const selectTodoIds = createSelector(
  [(state: State) => state.todos],
  todos => todos.map(todo => todo.id),
  {
    memoize: lruMemoize,
    memoizeOptions: {
      resultEqualityCheck: (a: number[], b: number[]) =>
        a.length === b.length && a.every((id, index) => id === b[index])
    }
  }
)

const firstState = { todos: [{ id: 1, title: 'one' }] }
const secondState = { todos: [{ id: 1, title: 'changed elsewhere' }] }

const first = selectTodoIds(firstState)
const second = selectTodoIds(secondState)

assert.deepEqual(first, [1])
assert.strictEqual(first, second)
```

## `createSelectorCreator`

Use `createSelectorCreator` to make a family of selectors with shared memoization configuration. The current configuration form takes an options object. The legacy form, `memoize, ...memoizeOptions`, is also accepted, but prefer the options object in new code.

```ts pmcp-example
import assert from 'node:assert/strict'
import { createSelectorCreator, lruMemoize } from 'reselect'

const createShallowEqualSelector = createSelectorCreator({
  memoize: lruMemoize,
  memoizeOptions: {
    resultEqualityCheck: (a: number[], b: number[]) =>
      a.length === b.length && a.every((value, index) => value === b[index])
  }
})

const selectValues = createShallowEqualSelector(
  [(state: { values: number[] }) => state.values],
  values => values.map(value => value)
)

const first = selectValues({ values: [1, 2] })
const second = selectValues({ values: [1, 2] })

assert.deepEqual(first, [1, 2])
assert.strictEqual(first, second)
```

## `createStructuredSelector`

Pass an object whose values are input selectors. The returned selector computes each value and returns an object with the same keys.

```ts pmcp-example
import assert from 'node:assert/strict'
import { createStructuredSelector } from 'reselect'

type State = {
  todos: Record<number, { id: number }>
  alerts: string[]
}

const structuredSelector = createStructuredSelector({
  todos: (state: State) => state.todos,
  alerts: (state: State) => state.alerts,
  todoById: (state: State, id: number) => state.todos[id]
})

const todo = { id: 7 }
const state = { todos: { 7: todo }, alerts: ['late'] }

assert.deepEqual(structuredSelector(state, 7), {
  todos: { 7: todo },
  alerts: ['late'],
  todoById: todo
})
```

## Memoizer exports

`lruMemoize` and `weakMapMemoize` are the memoizer exports used for custom configuration. `weakMapMemoize` uses argument identity and has an effectively unlimited cache. `lruMemoize` supports configurable cache and equality behavior.

For a selector-wide choice, configure `memoize` directly:

```ts pmcp-example
import assert from 'node:assert/strict'
import { createSelector, weakMapMemoize } from 'reselect'

const selectLength = createSelector(
  [(state: { items: unknown[] }) => state.items],
  items => items.length,
  { memoize: weakMapMemoize }
)

const state = { items: ['a', 'b', 'c'] }
assert.equal(selectLength(state), 3)
assert.equal(selectLength(state), 3)
```

## Development checks

Development-only checks include `inputStabilityCheck` and `identityFunctionCheck`; the current documentation also lists `cacheSizeCheck`. Checks are disabled in production environments and default to running `once`.

Configure supported global checks with `setGlobalDevModeChecks`, or override checks per selector through `devModeChecks`:

```ts pmcp-example
import assert from 'node:assert/strict'
import { createSelector, setGlobalDevModeChecks } from 'reselect'

setGlobalDevModeChecks({ inputStabilityCheck: 'always' })
setGlobalDevModeChecks({ identityFunctionCheck: 'never' })

const selectTodoIds = createSelector(
  [(state: { todos: Array<{ id: number }> }) => state.todos],
  todos => todos.map(todo => todo.id),
  {
    devModeChecks: {
      inputStabilityCheck: 'always',
      identityFunctionCheck: 'never'
    }
  }
)

assert.deepEqual(selectTodoIds({ todos: [{ id: 1 }] }), [1])
```

`cacheSizeCheck` is configured only globally. A selector-level `devModeChecks.cacheSizeCheck` setting has no effect because that check runs inside `weakMapMemoize`.

## v5 migration traps

- Do not use the v4 names `defaultMemoize` or `defaultEqualityCheck`; they were renamed to `lruMemoize` and `referenceEqualityCheck`.
- Do not assume the v4 cache-size-one default. v5 uses `weakMapMemoize` for both `memoize` and `argsMemoize` by default.
- Use `Selector` and `OutputSelector` for selectors with additional parameters; `ParametricSelector` and `OutputParametricSelector` were removed.
- TypeScript versions below 4.7 are unsupported.
- The second `createStructuredSelector` overload was removed.
- `createSelector.withTypes<StateType>()` is only available from 5.1.0 onward and is therefore not guaranteed across the entire `^5.0.0` range. Its documented inference limitation is that input selectors must be supplied as one array.

## Not covered

This skill does not cover undocumented internals, exact cache-size or equality defaults beyond the v5 behavior described above, framework integrations, production build configuration, or APIs not shown in the supplied research. It also does not prescribe how a runner or application invokes selectors; Reselect itself exposes no required CLI or runner workflow in the researched surface.
