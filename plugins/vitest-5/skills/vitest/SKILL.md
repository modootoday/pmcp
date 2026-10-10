---
name: vitest
description: Use Vitest ^5.0.0 standalone assertions and mock functions correctly, while avoiding APIs that require the Vitest runner and accounting for v5 migration changes.
---

Verified against vitest@5.0.0 on 2026-09-07. 5 of 5 examples executed.

# Vitest ^5.0.0

## Requirements

Vitest 5 requires Node.js >= 22.12.0 and Vite >= 6.4.0.

Assertions are bundled into `vitest`; import `expect`, `vi`, and test APIs from `vitest` rather than relying on `@vitest/expect`.

## What can run in a plain script

A plain script can directly exercise assertions and several mock-function APIs exported by `vitest`. The examples below are standalone files: they do not use the Vitest runner.

### Assertions

Use `expect` from `vitest` for matchers such as `toBe`, `toBeCloseTo`, and `toContain`.

```ts pmcp-example
import { expect } from 'vitest'

expect(Math.sqrt(4)).toBe(2)
expect(Math.sqrt(144)).toBe(12)
expect(Math.sqrt(0)).toBe(0)
expect(0.1 + 0.2).toBeCloseTo(0.3)
expect('vitest').toContain('test')
```

`expect.assertions(count)` is documented for checking the number of assertions made during a test run; it is not a standalone assertion-counting mechanism to rely on in an ordinary script.

### Mock functions

`vi.fn()` creates a mock function. Calls are recorded even when the function has no implementation, in which case it returns `undefined`.

```ts pmcp-example
import { expect, vi } from 'vitest'

const getApples = vi.fn()

getApples()

expect(getApples).toHaveBeenCalled()
expect(getApples).toHaveBeenCalledTimes(1)
expect(getApples()).toBeUndefined()
```

### Spying on an object method

`vi.spyOn(object, key)` creates a mock around an existing object method. Restore it with `vi.restoreAllMocks()` when the original implementation should be put back.

```ts pmcp-example
import { expect, vi } from 'vitest'

const calculator = {
  add(a: number, b: number) {
    return a + b
  },
}

const add = vi.spyOn(calculator, 'add')

expect(calculator.add(2, 3)).toBe(5)
expect(add).toHaveBeenCalledWith(2, 3)

vi.restoreAllMocks()
expect(calculator.add(1, 1)).toBe(2)
```

### Conditional mock behavior with `vi.when`

Vitest 5 adds argument-based behavior configuration for mocks. Chain `calledWith(...).thenReturn(...)` clauses to return different values for different arguments.

```ts pmcp-example
import { expect, vi } from 'vitest'

const spy = vi.fn()

vi.when(spy)
  .calledWith(1)
  .thenReturn('one')
  .calledWith(2)
  .thenReturn('two')

expect(spy(1)).toBe('one')
expect(spy(2)).toBe('two')
```

### Mock lifecycle APIs

- `vi.clearAllMocks()` clears recorded calls while preserving mock implementations.
- `vi.resetAllMocks()` resets mock state and restores the mock's initial implementation. For a mock created with an implementation, that initial implementation remains available.
- `vi.restoreAllMocks()` restores spied-on originals.

Vitest 5 also defaults `clearMocks` to `true`, so the runner calls `vi.clearAllMocks()` before every test while preserving implementations.

```ts pmcp-example
import { expect, vi } from 'vitest'

const mock = vi.fn(() => 'value')

mock()
expect(mock).toHaveBeenCalledTimes(1)

vi.clearAllMocks()
expect(mock).toHaveBeenCalledTimes(0)
expect(mock()).toBe('value')

vi.resetAllMocks()
expect(mock()).toBe('value')
```

`vi.mockObject(value)` is not a standalone API in this environment: it reaches for Vitest's initialized mocker and throws when no runner has initialized it. Use it only under Vitest's transformed module runner.

## APIs that require the Vitest runner

Importing `test` or `it` from `vitest` is not enough to execute tests in an ordinary script. The callback is collected and run by Vitest's runner or its CLI/build integration.

The documented form is:

```ts
import { expect, test } from 'vitest'

test('Math.sqrt works for perfect squares', () => {
  expect(Math.sqrt(4)).toBe(2)
})
```

Test callbacks can receive a test context. Documented built-ins include `task`, `expect`, `signal`, `bench`, `onTestFailed`, and `onTestFinished`:

```ts
import { it } from 'vitest'

it('math is easy', ({ expect }) => {
  expect(2 + 2).toBe(4)
})
```

These snippets belong in files executed by Vitest, not in a direct `bun example.ts` invocation.

## v5 benchmarks

Benchmarks moved into regular tests through the `bench` test-context fixture. The old standalone shape is not the v5 shape:

```ts
import { test } from 'vitest'

test('sort', async ({ bench }) => {
  await bench('sort', () => {
    [3, 1, 2].sort()
  }).run()
})
```

`bench.skip`, `bench.only`, and `bench.todo` were removed. Use `test.skip`, `test.only`, and `test.todo` around the containing test instead. The `bench` fixture is runner-provided, so this is not a standalone Bun example.

## Module mocking

`vi.mock` substitutes imported modules and works with `import`, not `require`. Vitest statically analyzes and hoists it, so calls must be at module top level in v5:

```ts
import { vi } from 'vitest'

vi.mock('./path/to/module.js', () => ({
  default: { myDefaultKey: vi.fn() },
  namedExport: vi.fn(),
}))
```

Module mocking depends on Vitest's transformed module runner and is intended for test files. It is not equivalent to ordinary standalone Node or Bun module behavior. Unlike `vi.mock`, `vi.doMock` and `vi.doUnmock` remain non-hoisted.

Do not put `vi.mock`, `vi.unmock`, or `vi.hoisted` inside a function or nested scope in v5; nested calls throw.

## v5 migration traps

- Replace removed `test.sequential`, `describe.sequential`, and `sequential` options with `concurrent: false`.
- Do not use the former top-level `bench(...)` API for v5 benchmarks; use the test-context `bench` fixture.
- Do not import removed entrypoints such as `vitest/coverage`, `vitest/reporters`, `vitest/environments`, `vitest/snapshot`, `vitest/runners`, `vitest/suite`, `vitest/mocker`, or `vitest/internal/module-runner`. The migration replacements include `vitest/node`, `vitest/runtime`, `TestRunner` from `vitest`, static `TestRunner` methods, and `@vitest/mocker`.

## Not covered

This skill does not cover Vitest configuration, CLI invocation, runner/build integration, environment setup, reporters, coverage configuration, snapshots, the complete matcher catalog, custom matcher implementation, module-resolution details, `vi.mockObject` outside the runner, or the full test-context lifecycle API. Those areas require the Vitest runner or additional documentation beyond the supplied research.
