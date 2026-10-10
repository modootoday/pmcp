---
name: zod-validation-error
description: Use zod-validation-error ^5.0.0 with Zod 4 by default, including direct ValidationError construction, Zod error conversion, type guards, message builders, and the separate Zod 3 entrypoint.
---

Verified against zod-validation-error@5.0.0 on 2026-09-08. 7 of 7 examples executed.

# zod-validation-error v5

Use this skill for `zod-validation-error` version `^5.0.0`. It requires Node.js 18 or newer and TypeScript 4.5 or newer. The default package entrypoint is the Zod 4 build. Zod is a peer dependency and must be installed by the application.

## Important version distinction

Version 5 supports both Zod 4 and Zod 3, but they are separate package entrypoints:

- Import the default package for the Zod 4 surface: `zod-validation-error`.
- Import `zod-validation-error/v3` when using the Zod 3 surface.

Do not copy the older singleton error-map setup into the v5 default surface. The older form is:

```ts
import { z as zod } from 'zod';
import { errorMap } from 'zod-validation-error';

zod.setErrorMap(errorMap);
```

For v5 with Zod 4, create the map and configure Zod:

```ts
import { z as zod } from 'zod';
import { createErrorMap } from 'zod-validation-error';

zod.config({
  customError: createErrorMap(),
});
```

Zod 4 schemas also use the newer constructors shown by the package documentation, such as `zod.int()` and `zod.email()`. The older Zod 3 shape uses `zod.number().int()` and `zod.string().email()`.

## Direct `ValidationError`

`ValidationError` is an `Error` and can be used without Zod, for example when validating an argument in code that does not need a schema.

```ts pmcp-example
import assert from 'node:assert/strict';
import { ValidationError } from 'zod-validation-error';

const error = new ValidationError('Invalid argument; expected buffer');

assert.equal(error instanceof Error, true);
assert.equal(error.message, 'Invalid argument; expected buffer');
```

## Convert a Zod error

Use `fromError` when the caught value is not known to be a Zod error. Use a Zod 4 schema with the default package entrypoint.

```ts pmcp-example
import assert from 'node:assert/strict';
import { z as zod } from 'zod';
import { fromError, isValidationError } from 'zod-validation-error';

const schema = zod.object({
  id: zod.int().positive(),
  email: zod.email(),
});

let converted: unknown;
try {
  schema.parse({ id: -1, email: 'not-an-email' });
} catch (error) {
  converted = fromError(error);
}

assert.equal(isValidationError(converted), true);
assert.equal(converted instanceof Error, true);
```

`fromZodError` is the explicit conversion function when the value is already a Zod error.

```ts pmcp-example
import assert from 'node:assert/strict';
import { z as zod } from 'zod';
import { fromZodError, isValidationError } from 'zod-validation-error';

const schema = zod.object({ count: zod.int().positive() });
const result = schema.safeParse({ count: 0 });

assert.equal(result.success, false);
if (result.success) process.exit(1);

const error = fromZodError(result.error);
assert.equal(isValidationError(error), true);
assert.equal(error instanceof Error, true);
```

## Convert one issue

`fromZodIssue` converts a Zod issue directly into a `ValidationError`.

```ts pmcp-example
import assert from 'node:assert/strict';
import { fromZodIssue, isValidationError } from 'zod-validation-error';

const error = fromZodIssue({
  origin: 'number',
  code: 'too_small',
  minimum: 0,
  inclusive: false,
  path: ['id'],
  message: 'Number must be greater than 0 at "id"',
  input: -1,
});

assert.equal(isValidationError(error), true);
assert.equal(error instanceof Error, true);
```

## Convert with `toValidationError`

`toValidationError(options)` produces a function that accepts a Zod error and returns a `ValidationError`.

```ts pmcp-example
import assert from 'node:assert/strict';
import { z as zod } from 'zod';
import { isValidationError, toValidationError } from 'zod-validation-error';

const schema = zod.object({ name: zod.string().min(1) });
const result = schema.safeParse({ name: '' });

assert.equal(result.success, false);
if (result.success) process.exit(1);

const convert = toValidationError({});
const error = convert(result.error);

assert.equal(isValidationError(error), true);
```

## Message builders and error maps

`createMessageBuilder` accepts options including `maxIssuesInMessage` and `includePath`. `createErrorMap` creates the map used with Zod 4 configuration. The package documentation shows configuring both through the package API rather than relying on the older v3 singleton `errorMap`.

```ts pmcp-example
import assert from 'node:assert/strict';
import { z as zod } from 'zod';
import {
  createErrorMap,
  createMessageBuilder,
} from 'zod-validation-error';

const messageBuilder = createMessageBuilder({
  maxIssuesInMessage: 3,
  includePath: false,
});
const errorMap = createErrorMap();

assert.equal(typeof messageBuilder, 'function');
assert.equal(typeof errorMap, 'function');

zod.config({ customError: errorMap });
```

## Type guards

The documented guards are useful when handling unknown caught values:

- `isValidationError` checks for the package's `ValidationError`.
- `isValidationErrorLike` checks whether an unknown value has the validation-error shape expected by the package.
- `isZodErrorLike` checks whether an unknown value has a Zod-error-like shape.

A plain object containing only `name` and `message` is not necessarily validation-error-like. Use an actual package error or an actual Zod error when testing these guards.

```ts pmcp-example
import assert from 'node:assert/strict';
import { z as zod } from 'zod';
import {
  ValidationError,
  isValidationError,
  isValidationErrorLike,
  isZodErrorLike,
} from 'zod-validation-error';

const validationError = new ValidationError('invalid input');
const result = zod.string().parse;

let zodError: unknown;
try {
  zod.string().parse(123);
} catch (error) {
  zodError = error;
}

assert.equal(isValidationError(validationError), true);
assert.equal(isValidationErrorLike(validationError), true);
assert.equal(isValidationError(new Error('ordinary error')), false);
assert.equal(isZodErrorLike(zodError), true);
```

## Common mistakes

- **Using v3 imports or setup with the default v5 entrypoint.** The default export is the v4 build. Use `createErrorMap()` with `zod.config({ customError: ... })`.
- **Using the Zod 3 schema examples with Zod 4.** In the documented v5 surface, use `zod.int()` and `zod.email()` rather than assuming the older `zod.number().int()` and `zod.string().email()` examples apply.
- **Assuming a plain object is validation-error-like.** `isValidationErrorLike` checks the package's expected shape; `{ name, message }` alone does not satisfy it. Use a `ValidationError` or another value with the documented validation-error shape.
- **Assuming the package is a runner.** It has no documented CLI or test-runner integration requirement. Its conversion, error-map, builder, and guard APIs are callable from ordinary scripts.
- **Passing arbitrary caught values to APIs intended for Zod errors.** Use `fromError` for an unknown caught value; use `fromZodError` or `toValidationError` when the value is known to be a Zod error.
- **Forgetting the peer dependency.** The conversion and error-map APIs are built around Zod issue/error types, and the package declares Zod as a peer dependency.

## Not covered

This skill does not cover the detailed formatting of every generated message, all `createMessageBuilder` or `toValidationError` options beyond those documented above, custom issue construction beyond the shown issue, Zod schema design, package installation commands, or the full Zod 3 API. Those details were not established by the available research.
