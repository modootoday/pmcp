---
name: expect-type
description: Use expect-type ^1.0.0 for compile-time TypeScript assertions about values, types, functions, properties, and type transformations. It has no meaningful runtime assertion behavior; run TypeScript checking separately from any direct script execution.
---

Verified against expect-type@1.4.0 on 2026-09-08. 7 of 7 examples executed.

# expect-type v1.0.0

## What this package is

`expect-type` is a compile-time TypeScript assertion library. Import its main entry point with:

```ts
import {expectTypeOf} from 'expect-type'
```

Assertions are checked by TypeScript and reported by the IDE or `tsc`; they are not runtime tests. The package needs no special CLI, build step, runner, IDE extension, or lint plugin. Install it as a development dependency:

```sh
npm install expect-type --save-dev
```

When a plain script invokes the API, the chained methods have no meaningful runtime behavior. The examples below therefore include `node:assert/strict` checks only to verify that the exported function is available and that the calls can be made. The type assertions themselves must be checked with TypeScript.

## Exact equality versus assignability

Use `.toEqualTypeOf` when the types must be identical. Use `.toMatchTypeOf` when the actual type may contain additional properties.

```ts pmcp-example
import {strict as assert} from 'node:assert'
import {expectTypeOf} from 'expect-type'

assert.equal(typeof expectTypeOf, 'function')

expectTypeOf({a: 1}).toEqualTypeOf<{a: number}>()
expectTypeOf({a: 1, b: 1}).toMatchTypeOf<{a: number}>()

// This is intentionally a compile-time failure when the directive is checked.
// @ts-expect-error extra properties are not allowed by exact equality
expectTypeOf({a: 1, b: 1}).toEqualTypeOf<{a: number}>()
```

Older examples commonly use `.toMatchTypeOf` for this distinction. In v1, use `.toEqualTypeOf` for exact equality and reserve `.toMatchTypeOf` for the extra-property/assignability case.

## Primitive and structural assertions

The documented primitive and structural checks are available directly on an inspected value:

```ts pmcp-example
import {strict as assert} from 'node:assert'
import {expectTypeOf} from 'expect-type'

assert.equal(typeof expectTypeOf, 'function')

expectTypeOf(() => 1).toBeFunction()
expectTypeOf({}).toBeObject()
expectTypeOf([]).toBeArray()
expectTypeOf('').toBeString()
expectTypeOf(1).toBeNumber()
expectTypeOf(true).toBeBoolean()
expectTypeOf(Symbol(1)).toBeSymbol()
expectTypeOf({a: 1}).toHaveProperty('a').toBeNumber()
```

You can also provide the type argument without a runtime value:

```ts pmcp-example
import {strict as assert} from 'node:assert'
import {expectTypeOf} from 'expect-type'

assert.equal(typeof expectTypeOf, 'function')

expectTypeOf<{a: number}>().toHaveProperty('a').toBeNumber()
expectTypeOf<string>().toBeString()
expectTypeOf<number>().toBeNumber()
```

## Function parameters, returns, overloads, and `this`

For a function value, inspect an individual parameter with `.parameter(index)`, all parameters with `.parameters`, and the return type with `.returns`:

```ts pmcp-example
import {strict as assert} from 'node:assert'
import {expectTypeOf} from 'expect-type'

assert.equal(typeof expectTypeOf, 'function')

const f = (a: number) => [a, a]

expectTypeOf(f).toBeCallableWith(1)
expectTypeOf(f).parameter(0).toBeNumber()
expectTypeOf(f).parameters.toEqualTypeOf<[number]>()
expectTypeOf(f).returns.toEqualTypeOf([1, 2])
```

Function overloads are represented differently from TypeScript's built-in utility types. For an overloaded function, the documented shape is a union of parameter tuples and a union of return types:

```ts pmcp-example
import {strict as assert} from 'node:assert'
import {expectTypeOf} from 'expect-type'

type Factorize = {
  (input: number): number[]
  (input: bigint): bigint[]
}

assert.equal(typeof expectTypeOf, 'function')
expectTypeOf<Factorize>().parameters.toEqualTypeOf<[number] | [bigint]>()
expectTypeOf<Factorize>().returns.toEqualTypeOf<number[] | bigint[]>()
expectTypeOf<Factorize>().parameter(0).toEqualTypeOf<number | bigint>()
```

The API also exposes function `this`-parameter support through `.thisParameter`.

## Type transformations and modifiers

The documented chain includes `.not`, `.branded`, `.extract`, `.exclude`, `.pick`, `.omit`, `.resolves`, `.items`, `.guards`, `.asserts`, `.instance`, `.constructorParameters`, `.thisParameter`, and `.toBeConstructibleWith`. These are type-level chains; use them in a type-checked file rather than expecting runtime test results.

```ts pmcp-example
import {strict as assert} from 'node:assert'
import {expectTypeOf} from 'expect-type'

assert.equal(typeof expectTypeOf, 'function')

type Value = {id: string; count: number}
type Branded = string & {readonly __brand: 'id'}
type AsyncValue = Promise<number>
type ItemList = number[]
type Constructor = new (value: string) => {value: string}

expectTypeOf<Value>().not.toBeString()
expectTypeOf<Branded>().branded.toEqualTypeOf<Branded>()
expectTypeOf<Value | null>().extract<Value>().toEqualTypeOf<Value>()
expectTypeOf<Value | null>().exclude<null>().toEqualTypeOf<Value>()
expectTypeOf<Value>().pick<'id'>().toEqualTypeOf<{id: string}>()
expectTypeOf<Value>().omit<'count'>().toEqualTypeOf<{id: string}>()
expectTypeOf<AsyncValue>().resolves.toBeNumber()
expectTypeOf<ItemList>().items.toBeNumber()
expectTypeOf<Constructor>().constructorParameters.toEqualTypeOf<[string]>()
expectTypeOf<Constructor>().toBeConstructibleWith('value')
```

The package also provides `.guards`, `.asserts`, `.instance`, and `.thisParameter` for the corresponding function, instance, and `this`-type checks. Their assertions are likewise compile-time-only.

## Intersections and deep types

A documented limitation is that exact equality can reject a structurally equivalent intersection:

```ts pmcp-example
import {strict as assert} from 'node:assert'
import {expectTypeOf} from 'expect-type'

assert.equal(typeof expectTypeOf, 'function')

// This is documented as a limitation; the directive should be checked by tsc.
// @ts-expect-error intersections may not be recognized as identical object types
expectTypeOf<{a: 1} & {b: 2}>().toEqualTypeOf<{a: 1; b: 2}>()
```

For simple intersections, use a mapped `Simplify` type before asserting equality. `.branded` is the deeper workaround, but it has a compiler performance cost and can make TypeScript give up on excessively deep types.

## Does not cover

This skill does not cover runtime validation, runtime behavior of the values being inspected, a test-runner integration, CLI usage, configuration files, or the complete signatures of every re-exported internal type and helper. The research only establishes the public `expectTypeOf` entry point and the documented chains listed above. Type assertions must be checked by TypeScript; running an example directly with Bun does not replace `tsc`.
