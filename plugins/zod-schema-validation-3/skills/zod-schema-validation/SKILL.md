---
name: zod-schema-validation
description: Use Zod 3 schemas for runtime validation, coercion, object/tuple/record composition, and safe parsing in TypeScript or plain scripts.
---

Verified against zod@3.25.76 on 2026-09-07. 7 of 7 examples executed.

# Zod 3

Use this skill for the `zod` package with version range `^3.0.0`. The documented API is the Zod 3 API. The documentation requires TypeScript 4.5+ with `strict` mode enabled.

## Import and version boundary

The documented default import is:

```ts
import { z } from "zod";
```

When supporting both Zod major versions, the maintainer documentation identifies `zod/v3` as the stable Zod 3 subpath. Do not assume examples written for another major have the same exports or signatures. In particular, use the exported `z` variable rather than older import shapes.

## Primitive schemas and parsing

Create primitive schemas with constructors such as:

- `z.string()`
- `z.number()`
- `z.bigint()`
- `z.boolean()`
- `z.date()`
- `z.symbol()`
- `z.undefined()`
- `z.null()`
- `z.void()`
- `z.any()`
- `z.unknown()`
- `z.never()`

`.parse(value)` returns the parsed value when valid and throws a `ZodError` when invalid. `.safeParse(value)` does not throw for validation failure; it returns an object with either `{ success: true, data }` or `{ success: false, error }`.

```ts pmcp-example
import { z } from "zod";
import assert from "node:assert/strict";

const schema = z.string();

assert.equal(schema.parse("tuna"), "tuna");
assert.throws(() => schema.parse(12));

const valid = schema.safeParse("tuna");
assert.equal(valid.success, true);
if (valid.success) assert.equal(valid.data, "tuna");

const invalid = schema.safeParse(12);
assert.equal(invalid.success, false);
```

## Object schemas and inferred types

Use `z.object({...})` to validate object shapes. `z.infer<typeof Schema>` is a TypeScript-only utility that extracts the schema's inferred type; it does not perform runtime work.

```ts pmcp-example
import { z } from "zod";
import assert from "node:assert/strict";

const User = z.object({
  username: z.string(),
});

type User = z.infer<typeof User>;
const user: User = { username: "Ludwig" };

assert.deepEqual(User.parse(user), { username: "Ludwig" });
assert.equal(User.safeParse({ username: 42 }).success, false);
```

## Coercion

The `z.coerce` constructors convert input before applying the schema:

- `z.coerce.string()` uses string coercion.
- `z.coerce.number()` uses number coercion.
- `z.coerce.boolean()` uses boolean coercion.
- `z.coerce.bigint()` uses bigint coercion.
- `z.coerce.date()` constructs a date.

A coerced string schema is a normal `ZodString`, so string methods such as `.email()` and `.min()` can be chained.

```ts pmcp-example
import { z } from "zod";
import assert from "node:assert/strict";

assert.equal(z.coerce.string().parse(12), "12");
assert.equal(z.coerce.string().parse("tuna"), "tuna");
assert.equal(z.coerce.number().parse("12"), 12);
assert.equal(z.coerce.boolean().parse(1), true);

const email = z.coerce.string().email().min(5);
assert.equal(email.parse("a@b.co"), "a@b.co");
assert.equal(email.safeParse("not-an-email").success, false);
```

## Custom messages

Primitive schemas accept `invalid_type_error` and `required_error` options for custom validation messages.

```ts pmcp-example
import { z } from "zod";
import assert from "node:assert/strict";

const name = z.string({
  invalid_type_error: "Name must be string",
  required_error: "Name is required",
});

const result = name.safeParse(123);
assert.equal(result.success, false);
if (!result.success) {
  assert.equal(result.error.issues[0]?.message, "Name must be string");
}
```

## Tuples and rest elements

`z.tuple([...])` defines positional elements. Add trailing elements with `.rest(schema)`. `z.output<typeof schema>` is a TypeScript utility for the parsed output type.

```ts pmcp-example
import { z } from "zod";
import assert from "node:assert/strict";

const myTuple = z.tuple([z.string(), z.number()]).rest(z.boolean());
type TupleOutput = z.output<typeof myTuple>;

const value: TupleOutput = ["count", 2, true, false];
assert.deepEqual(myTuple.parse(value), ["count", 2, true, false]);
assert.equal(myTuple.safeParse(["count", 2, "not boolean"]).success, false);
```

## Selective partial objects

For an object schema, `.partial({ name: true })` makes only the selected property optional. It does not make every property optional.

```ts pmcp-example
import { z } from "zod";
import assert from "node:assert/strict";

const user = z.object({
  name: z.string(),
  age: z.number(),
});

const optionalNameUser = user.partial({ name: true });

assert.deepEqual(optionalNameUser.parse({ age: 30 }), { age: 30 });
assert.equal(optionalNameUser.safeParse({ name: "Ada" }).success, false);
```

## Records

Use `z.record(keySchema, valueSchema)` to validate record keys and values. The inferred type can be extracted with `z.infer`.

```ts pmcp-example
import { z } from "zod";
import assert from "node:assert/strict";

const schema = z.record(z.number(), z.boolean());
type Schema = z.infer<typeof schema>;

const empty: Schema = {};
assert.deepEqual(schema.parse(empty), {});
```

## Async parsing

Schemas that use asynchronous refinements or transforms must use `.parseAsync()` or `.safeParseAsync()` rather than their synchronous counterparts. The reviewed material identifies these method names but does not provide a complete Zod 3 async signature or example; keep async schema details within the package's documented API rather than inventing a synchronous equivalent.

## Common version and shape mistakes

- Do not substitute a newer-major API for the Zod 3 API when the dependency is `^3.0.0`.
- Do not rely on older examples that omit the exported `z` variable; Zod 3 documents `import { z } from "zod"`.
- Do not treat `.safeParse()` as throwing on invalid input. Inspect its `success` field and read `data` or `error` conditionally.
- Do not treat `z.infer` or `z.output` as runtime functions. They are TypeScript type utilities.
- Do not use `.parse()` for schemas with asynchronous refinements or transforms; use `.parseAsync()` or `.safeParseAsync()`.
- Within Zod 3, `.or()` and `.transform()` changed in 3.2 to return new wrapper instances rather than the earlier flattening/avoiding-nesting shape. Code that depends on the internal schema nesting should not assume the pre-3.2 shape.

## Not covered

This skill does not cover the complete exported-symbol list, exhaustive method signatures, every Zod 3 schema combinator, detailed asynchronous refinement/transform construction, custom error maps, custom `ZodType` subclasses, CLI or build commands, or the complete differences between Zod 1, Zod 2, Zod 3, and later majors.
