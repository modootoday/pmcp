---
name: tinyspy
description: Use tinyspy ^4.0.0 as an ESM-only spying library in standalone TypeScript or JavaScript scripts.
---

Verified against tinyspy@4.0.6 on 2026-09-08. 5 of 5 examples executed.

# tinyspy

Use this skill for `tinyspy` `^4.0.0`.

## Package shape and import rule

tinyspy v4 is ESM-only and declares Node `>=14.0.0`. Import named exports from the package:

```ts
import { spy, spyOn } from 'tinyspy'
```

Do not copy the v3 CommonJS shape from older examples. In v4, do not use `require('tinyspy')` or reference `dist/index.cjs`; use the package's ESM entrypoint.

## Standalone function spies

`spy` accepts a callback, or a constructor, and returns a callable spy. Calling it forwards to the original callback and records the invocation.

```ts pmcp-example
import assert from 'node:assert/strict'
import { spy } from 'tinyspy'

const spied = spy((n: string) => n + '!')

assert.equal(spied('a'), 'a!')
assert.equal(spied.called, true)
assert.equal(spied.callCount, 1)
assert.deepEqual(spied.calls, [['a']])
assert.deepEqual(spied.results, [['ok', 'a!']])
assert.deepEqual(spied.returns, ['a!'])

spied.reset()
assert.equal(spied.called, false)
assert.equal(spied.callCount, 0)
assert.deepEqual(spied.calls, [])
```

A spy can also be created without a callback when a callable spy is needed; the available research does not specify its return behavior, so do not assume one.

## Spying on object methods

`spyOn(object, key)` replaces the object method with a spy. You can provide a replacement implementation as the third argument, or configure one with `willCall`. Restore an individual method with `restore()`.

`getOriginal()` returns the original method, not the replacement spy currently installed on the object. Capture the original before asserting its identity:

```ts pmcp-example
import assert from 'node:assert/strict'
import { spyOn } from 'tinyspy'

const original = () => 13
const obj = {
  getApples: original,
}

const spied = spyOn(obj, 'getApples', () => 1)
assert.equal(obj.getApples(), 1)
assert.equal(spied.called, true)
assert.deepEqual(spied.returns, [1])
assert.equal(spied.getOriginal(), original)

spied.restore()
assert.equal(obj.getApples(), 13)

const configured = spyOn(obj, 'getApples').willCall(() => 2)
assert.equal(obj.getApples(), 2)
configured.restore()
assert.equal(obj.getApples(), 13)
```

`spyOn` also supports accessor descriptors using `{ getter: 'name' }` and `{ setter: 'name' }`. The available research confirms those forms but does not provide enough behavior detail for a reliable standalone example.

## Recorded outcomes and controls

The documented spy controls are `called`, `callCount`, `calls`, `results`, `returns`, `resolves`, `reset()`, `nextError(error)`, and `nextResult(result)`.

`nextResult` and `nextError` affect the next call. A result entry records the outcome as an `['ok', value]` or error outcome. Use the spy's normal return value and recorded state to inspect the call.

```ts pmcp-example
import assert from 'node:assert/strict'
import { spy } from 'tinyspy'

const spied = spy((value: number) => value * 2)

spied.nextResult(99)
assert.equal(spied(3), 99)

spied.nextError(new Error('planned'))
assert.throws(() => spied(4), /planned/)

assert.equal(spied.callCount, 2)
assert.deepEqual(spied.calls, [[3], [4]])
assert.equal(spied.results[0]?.[0], 'ok')
assert.equal(spied.results[0]?.[1], 99)
assert.equal(spied.results[1]?.[0], 'error')
```

## Async spies

Async spies retain Promise values in `returns` and `results`; await the returned promise manually. `resolves` records resolved outcomes as result entries, including the `'ok'` tag and resolved value.

```ts pmcp-example
import assert from 'node:assert/strict'
import { spy } from 'tinyspy'

const spied = spy(async (value: number) => value + 1)
const returned = spied(4)

assert.equal(spied.callCount, 1)
assert.equal(spied.returns.length, 1)
assert.equal(spied.results.length, 1)
assert.equal(spied.resolves.length, 0)
assert.equal(await returned, 5)
assert.deepEqual(spied.resolves, [['ok', 5]])
```

## Restoring all spies

`restoreAll()` restores every registered spy and then clears the registry. Use it when several object methods have been replaced and they should all return to their originals.

```ts pmcp-example
import assert from 'node:assert/strict'
import { restoreAll, spyOn } from 'tinyspy'

const first = {
  value: () => 'first original',
}
const second = {
  value: () => 'second original',
}

spyOn(first, 'value', () => 'first replacement')
spyOn(second, 'value', () => 'second replacement')
assert.equal(first.value(), 'first replacement')
assert.equal(second.value(), 'second replacement')

restoreAll()
assert.equal(first.value(), 'first original')
assert.equal(second.value(), 'second original')
```

## Constructors and internal exports

The v4 public entrypoint exports `spy`, `spyOn`, `restoreAll`, `createInternalSpy`, `spies`, and `getInternalState`, plus the types `Spy`, `SpyImpl`, `SpyInternal`, and `SpyInternalImpl`. The research confirms that `spy` and `spyOn` support constructors, but does not specify constructor-call behavior or the contracts of the internal-state and registry exports. Do not infer those contracts from older versions.

## What this skill does not cover

- Detailed constructor-spy usage.
- Getter and setter examples beyond the supported `spyOn` option forms.
- Contracts or usage patterns for `createInternalSpy`, `spies`, or `getInternalState`; these internal surfaces may only be reachable in the context of the tool or runner that uses them.
- Exact error-entry structure beyond the documented outcome controls.
- Any CommonJS usage; v4 is ESM-only.
