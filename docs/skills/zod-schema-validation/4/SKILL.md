---
name: zod-schema-validation
description: A boundary needs validating and the code either trusts a cast, throws where it should have branched, or hand-rolls an error shape; or a parse failure reaches a person as a stack trace instead of a message naming the field that was wrong.
---

Verified against zod@4.5.4 on 2026-09-07. 7 of 7 examples executed.

# zod

Parse at the boundary, then trust the value. The point of a schema is that
everything past it is typed because it was checked, not because it was cast.

## When to reach for it

Reach for this when data arrives from outside the program and its shape is a
claim rather than a fact: a request body, a config file, an environment
variable, a third-party response. Do not reach for it to re-check a value your
own code just produced.

## Parse or branch, not both

`parse` throws and `safeParse` returns a result. Pick by whether the caller has
something to do about a failure. A route that must answer 400 branches; a boot
path that cannot continue throws.

```ts pmcp-example
import { z } from "zod";
import assert from "node:assert/strict";

const Config = z.object({ port: z.number(), host: z.string() });

// safeParse when the caller answers for the failure.
const result = Config.safeParse({ port: "8080", host: "localhost" });
assert.equal(result.success, false);

// parse when there is no answer but to stop.
assert.deepEqual(Config.parse({ port: 8080, host: "localhost" }), {
  port: 8080,
  host: "localhost",
});
```

## Unknown keys are dropped, not rejected

An object schema ignores keys it does not declare and returns only what it
declared. This is the behaviour most often assumed wrong in both directions:
it does not fail, and it does not pass the extra key through.

```ts pmcp-example
import { z } from "zod";
import assert from "node:assert/strict";

const User = z.object({ id: z.string() });
const parsed = User.parse({ id: "u1", role: "admin" });

// The undeclared key is gone. Reading parsed.role would be undefined, so an
// authorization check written against it silently never fires.
assert.deepEqual(parsed, { id: "u1" });
assert.equal("role" in parsed, false);
```

If the extra key should be an error, say so with `.strict()`; if it should
survive, say so with `.passthrough()`. Both are explicit, and the default is
neither.

```ts pmcp-example
import { z } from "zod";
import assert from "node:assert/strict";

const Strict = z.object({ id: z.string() }).strict();
assert.equal(Strict.safeParse({ id: "u1", extra: 1 }).success, false);

const Open = z.object({ id: z.string() }).passthrough();
assert.deepEqual(Open.parse({ id: "u1", extra: 1 }), { id: "u1", extra: 1 });
```

## Read the failure, do not stringify it

A `ZodError` carries `issues`, and each issue names the path that failed. That
path is what a person needs; the stack trace is not.

```ts pmcp-example
import { z } from "zod";
import assert from "node:assert/strict";

const Order = z.object({ item: z.object({ qty: z.number() }) });
const outcome = Order.safeParse({ item: { qty: "two" } });

assert.equal(outcome.success, false);
if (!outcome.success) {
  const [issue] = outcome.error.issues;
  assert.deepEqual(issue.path, ["item", "qty"]);
  assert.equal(issue.code, "invalid_type");
  // `expected` is what the schema wanted, which is what the message should say.
  assert.equal(issue.expected, "number");
}
```

For a whole-form answer, `z.treeifyError` groups messages by field, which maps
onto a form without any reshaping of your own.

```ts pmcp-example
import { z } from "zod";
import assert from "node:assert/strict";

const Signup = z.object({ email: z.string(), age: z.number() });
const outcome = Signup.safeParse({ email: 1, age: "old" });

assert.equal(outcome.success, false);
if (!outcome.success) {
  const tree = z.treeifyError(outcome.error);
  assert.ok(tree.properties?.email?.errors.length);
  assert.ok(tree.properties?.age?.errors.length);
}
```

## Let the schema be the type

Infer the type from the schema instead of declaring both. Two declarations
drift, and the one that drifts is the one the compiler is not checking.

```ts pmcp-example
import { z } from "zod";
import assert from "node:assert/strict";

const Session = z.object({ userId: z.string(), expiresAt: z.number() });
type Session = z.infer<typeof Session>;

const session: Session = Session.parse({ userId: "u1", expiresAt: 1 });
assert.equal(session.userId, "u1");
```

## Coerce only where the wire is untyped

`z.coerce` converts before checking, which is right for query strings and
environment variables and wrong for a JSON body that already has types. Coercing
a JSON number field hides a producer sending strings.

```ts pmcp-example
import { z } from "zod";
import assert from "node:assert/strict";

const Query = z.object({ page: z.coerce.number() });
assert.deepEqual(Query.parse({ page: "2" }), { page: 2 });

const Body = z.object({ page: z.number() });
assert.equal(Body.safeParse({ page: "2" }).success, false);
```

## What this skill does not cover

Async refinement, custom error maps, and codec composition each have enough
surface to be their own skill. Discriminated unions are worth reading about
before modelling a tagged payload as a plain union, because the error a plain
union produces names every branch it tried.
