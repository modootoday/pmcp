---
name: superstruct
description: Use Superstruct ^2.0.0 for runtime validation, coercion, defaults, refinements, and object-shape utilities. Prefer the current named-export API; do not copy older struct.object/User.assert examples.
---

Verified against superstruct@2.0.2 on 2026-09-08. 4 of 4 examples executed.

# Superstruct 2.x

## Import and version boundary

Use named exports from `superstruct`, or a namespace import:

```ts
import { object, string, number, assert } from 'superstruct'

const User = object({ name: string(), age: number() })
assert(data, User)
```

`import * as s from 'superstruct'` is also supported (`s.object(...)`, `s.number()`, and so on).

This skill targets `^2.0.0`. Node.js 14 is deprecated by the maintainers and is no longer tested.

## Core operations

- `assert(value, struct, message?)` throws when validation fails and narrows the value in TypeScript.
- `create(value, struct, message?)` validates and returns the coerced/defaulted value.
- `is(value, struct)` returns a type guard and does not throw.
- `mask(value, struct, message?)` validates and returns a value limited to the struct's recognized shape.
- `validate(value, struct, options)` returns `[error, value]`; use `{}` when no validation options are needed.
- `StructError` is the exported error class for validation failures.

An `object()` struct validates its declared object shape. Do not assume that arbitrary extra properties make the input valid. Use `type()` when the documented shape should permit additional properties.

```ts pmcp-example
import { strict as nodeAssert } from 'node:assert'
import { StructError, assert, create, is, mask, number, object, string, validate } from 'superstruct'

const User = object({ id: number(), name: string() })
const input = { id: 1, name: 'Ada' }

nodeAssert.equal(is(input, User), true)
nodeAssert.deepEqual(create(input, User), input)
nodeAssert.deepEqual(mask(input, User), input)

const [error, value] = validate(input, User, {})
nodeAssert.equal(error, undefined)
nodeAssert.deepEqual(value, input)

assert(input, User, 'The user is invalid!')

const [badError] = validate({ id: 'wrong', name: 'Ada' }, User, {})
nodeAssert.ok(badError instanceof StructError)
```

## Struct factories

The documented factories are `any`, `array`, `bigint`, `boolean`, `date`, `enums`, `func`, `instance`, `integer`, `intersection`, `literal`, `map`, `never`, `number`, `nullable`, `object`, `optional`, `record`, `regexp`, `set`, `string`, `tuple`, `type`, `union`, and `unknown`.

Use factory calls for constraints and nested structures:

```ts
const Article = object({
  tags: array(string()),
  author: object({ id: number() }),
})
```

`object()` describes a recognized object shape. `type()` is the alternative shape that permits additional properties. `optional()` and `nullable()` express those states explicitly.

Custom types use `define(name, validator)`, or `struct(...)` for custom struct construction. The documented email example is:

```ts
const Email = define('Email', isEmail)
```

## Refinements

Use `empty`, `max`, `min`, `nonempty`, `pattern`, `size`, and `refine` to add constraints. Examples include `min(integer(), 0)`, `size(string(), 1, 100)`, and a named predicate with `refine`.

```ts pmcp-example
import { strict as nodeAssert } from 'node:assert'
import { integer, min, nonempty, pattern, refine, size, string, validate } from 'superstruct'

const Index = min(integer(), 0)
const Name = size(nonempty(string()), 1, 20)
const StartsWithThe = refine(string(), 'StartsWithThe', (value) => {
  return value.startsWith('The') && value.length > 3
})
const Hex = pattern(string(), /^[0-9a-f]+$/i)

nodeAssert.equal(validate(3, Index, {})[0], undefined)
nodeAssert.equal(validate('', Name, {})[0] instanceof Error, true)
nodeAssert.equal(validate('The book', StartsWithThe, {})[0], undefined)
nodeAssert.equal(validate('abc', Hex, {})[0], undefined)
```

## Coercion and defaults

- `coerce(target, source, transform)` transforms a value before applying the target struct.
- `create()` is the current operation for validating and coercing a value; do not use the old `coerce(data, User)` operation shape.
- `defaulted(struct, value)` supplies a value when the input is absent.
- `trimmed(string())` trims string input.

```ts pmcp-example
import { strict as nodeAssert } from 'node:assert'
import { coerce, create, defaulted, number, object, string, trimmed } from 'superstruct'

const MyNumber = coerce(number(), string(), (value) => parseFloat(value))
nodeAssert.equal(create('42', MyNumber), 42)

const User = defaulted(object({ id: number(), name: string() }), { id: 1, name: 'Anonymous' })
nodeAssert.deepEqual(create({}, User), { id: 1, name: 'Anonymous' })

nodeAssert.equal(create('  Ada  ', trimmed(string())), 'Ada')
```

## Struct utilities

The documented utility exports are `assign`, `deprecated`, `dynamic`, `lazy`, `omit`, `partial`, and `pick`. They compose or derive structs. Recursive structures use `lazy`, for example:

```ts
const Node = object({ id: number(), children: lazy(() => array(Node)) })
```

`omit`, `pick`, and `partial` derive object structs:

```ts
const PublicUser = omit(object({ id: number(), name: string() }), ['name'])
const OptionalUser = partial(object({ id: number(), name: string() }))
```

```ts pmcp-example
import { strict as nodeAssert } from 'node:assert'
import { array, lazy, number, object, omit, partial, pick, string, validate } from 'superstruct'

const Node = object({ id: number(), children: lazy(() => array(Node)) })
nodeAssert.equal(validate({ id: 1, children: [{ id: 2, children: [] }] }, Node, {})[0], undefined)

const User = object({ id: number(), name: string(), role: string() })
const PublicUser = omit(User, ['name'])
const NamedUser = pick(User, ['id', 'name'])
const OptionalUser = partial(object({ id: number(), name: string() }))

nodeAssert.equal(validate({ id: 1, role: 'admin' }, PublicUser, {})[0], undefined)
nodeAssert.equal(validate({ id: 1, name: 'Ada' }, NamedUser, {})[0], undefined)
nodeAssert.equal(validate({}, OptionalUser, {})[0], undefined)
```

## v2 migration traps

Do not use examples from the older pre-1.0 API merely because they remain common in existing code:

- `struct.object({ name: 'string' })` → `object({ name: string() })`
- `User.assert(data)` → `assert(data, User)`
- `struct('email', isEmail)` → `define('email', isEmail)`
- `refinement(...)` → `refine(...)`
- `coercion(...)` → `coerce(...)`
- `coerce(data, User)` → `create(data, User)`
- `length(string(), 1, 100)` → `size(string(), 1, 100)`
- `StructType<typeof User>` → `Infer<typeof User>`
- old `interface`, `enum`, and `function` names → `type`, `enums`, and `func`
- defaults and optional values → explicit `defaulted(...)` and `optional(...)`

In v2, arrays correctly fail validation against `object()`, `type()`, and `record()`. Object coercion no longer turns arrays into objects with numeric index keys. `mask()` also handles union members correctly. Do not preserve workarounds written for those older behaviors.

## What this skill does not cover

It does not cover every individual factory's full option and error-message behavior, TypeScript `Infer` usage beyond the migration note, browser UMD loading, or application-specific validation schemas. It also does not cover a CLI, test runner, framework integration, network behavior, or filesystem behavior; Superstruct's documented usage is direct library code.
