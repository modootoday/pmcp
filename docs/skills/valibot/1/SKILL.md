---
name: valibot
description: Use Valibot ^1.0.0 for dependency-free runtime validation and typed parsing in Node, Bun, or Deno.
---

Verified against valibot@1.4.2 on 2026-09-08. 6 of 6 examples executed.

# Valibot ^1.0.0

Use the package directly from ordinary JavaScript or TypeScript imports. It does not require a runner, CLI, framework globals, build step, network, or filesystem.

## Import and construct schemas

Use the namespace import:

```ts
import * as v from 'valibot';
```

Schemas are values. Common documented schema constructors include `string`, `number`, `boolean`, `array`, `object`, `tuple`, `union`, `literal`, `enum`, `picklist`, `record`, `map`, `set`, `date`, `instance`, `optional`, `nullable`, `nullish`, `unknown`, `any`, `never`, and `void`.

`object` removes unknown entries from the parsed output. Its basic shape is an entries object:

```ts
const UserSchema = v.object({
  name: v.string(),
  age: v.number(),
});
```

```ts pmcp-example
import * as v from 'valibot';
import assert from 'node:assert/strict';

const UserSchema = v.object({
  name: v.string(),
  age: v.number(),
});

const output = v.parse(UserSchema, {
  name: 'Ada',
  age: 36,
  ignored: true,
});

assert.deepEqual(output, { name: 'Ada', age: 36 });
```

## Pipelines: use `pipe`, not schema arguments

In the current API, compose validations with `v.pipe(schema, action, ...)`:

```ts
const EmailSchema = v.pipe(v.string(), v.email());
```

This is the v0.31+/v1 shape. Do not use the older form `v.string([v.email()])`.

```ts pmcp-example
import * as v from 'valibot';
import assert from 'node:assert/strict';

const LoginSchema = v.object({
  email: v.pipe(v.string(), v.email()),
  password: v.pipe(v.string(), v.minLength(8)),
});

const result = v.safeParse(LoginSchema, {
  email: 'jane@example.com',
  password: 'correct-horse',
});

assert.equal(result.success, true);
if (result.success) {
  assert.deepEqual(result.output, {
    email: 'jane@example.com',
    password: 'correct-horse',
  });
}
```

## Throwing parse

`v.parse(schema, input, config)` returns the inferred output and throws a `ValiError` for invalid input. Catch the error when invalid input is an expected possibility.

```ts pmcp-example
import * as v from 'valibot';
import assert from 'node:assert/strict';

const EmailSchema = v.pipe(v.string(), v.email());

assert.equal(v.parse(EmailSchema, 'jane@example.com'), 'jane@example.com');
assert.throws(
  () => v.parse(EmailSchema, 'not-an-email'),
  (error) => error instanceof v.ValiError
);
```

## Result-returning parse

`v.safeParse(schema, input, config)` does not throw for validation failure. Inspect `success`; successful results have `output`, while failed results have `issues`.

```ts pmcp-example
import * as v from 'valibot';
import assert from 'node:assert/strict';

const EmailSchema = v.pipe(v.string(), v.email());

const good = v.safeParse(EmailSchema, 'jane@example.com');
assert.equal(good.success, true);
if (good.success) assert.equal(good.output, 'jane@example.com');

const bad = v.safeParse(EmailSchema, 'not-an-email');
assert.equal(bad.success, false);
if (!bad.success) assert.ok(bad.issues.length > 0);
```

## Reusable parser

Create a reusable parser with `v.parser(schema, config)`. Calling it parses input with the supplied schema.

```ts pmcp-example
import * as v from 'valibot';
import assert from 'node:assert/strict';

const EmailSchema = v.pipe(v.string(), v.email());
const parseEmail = v.parser(EmailSchema);

assert.equal(parseEmail('jane@example.com'), 'jane@example.com');
assert.throws(() => parseEmail('not-an-email'));
```

The documented API also exposes `safeParser` when a reusable result-returning parser is needed.

## Transforming and coercing values

For the current API, compose accepted input schemas and a transform in a pipeline. Do not use the older `v.coerce(schema, callback)` shape.

```ts
const DateSchema = v.pipe(
  v.union([v.string(), v.number()]),
  v.transform((input) => new Date(input))
);
```

```ts pmcp-example
import * as v from 'valibot';
import assert from 'node:assert/strict';

const DateSchema = v.pipe(
  v.union([v.string(), v.number()]),
  v.transform((input) => new Date(input))
);

const output = v.parse(DateSchema, '2024-01-01T00:00:00.000Z');
assert.ok(output instanceof Date);
assert.equal(output.toISOString(), '2024-01-01T00:00:00.000Z');
```

## Current object and tuple variants

The older `rest` argument shape was removed from `object` and `tuple`. When a rest schema is required, use the explicit `objectWithRest` or `tupleWithRest` APIs instead. Do not pass a second rest schema to `object` or `tuple` expecting the older behavior.

## Common migration traps

- Pipelines moved from schema arguments to `v.pipe`.
- `object` and `tuple` no longer take the old `rest` argument; use `objectWithRest` and `tupleWithRest`.
- Coercion is expressed with `v.pipe`, an input union, and `v.transform` rather than `v.coerce`.
- `flatten` takes an issue array: use `v.flatten(error.issues)`, not `v.flatten(error)`.
- The newer names include `GenericSchema` instead of `BaseSchema`, and `check` instead of `custom`.
- Async-suffixed primitive schemas such as `stringAsync` and `numberAsync` became their normal names in the newer architecture.

## TypeScript and runtime notes

The documented runtimes are Node, Bun, and Deno. Distributed files target ES2020, and TypeScript 5.0.2 is the documented minimum; strict TypeScript mode is recommended. Tree shaking and code splitting are bundler benefits, not requirements for ordinary execution.

For inferred TypeScript output types, use `v.InferOutput<typeof Schema>`:

```ts
const LoginSchema = v.object({
  email: v.pipe(v.string(), v.email()),
  password: v.pipe(v.string(), v.minLength(8)),
});

type LoginData = v.InferOutput<typeof LoginSchema>;
```

## Not covered by this skill

The research does not specify the detailed behavior or signatures of every listed schema, method, configuration option, error shape, asynchronous API, or advanced schema composition. It also does not cover JSON Schema conversion in core: that is provided by the separate `@valibot/to-json-schema` package. Tooling such as the playground, codemods, and agent skill is outside ordinary Valibot validation.
