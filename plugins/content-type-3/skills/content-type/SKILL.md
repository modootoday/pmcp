---
name: content-type
description: Use content-type 3.x as an ESM-only parser and formatter for HTTP Content-Type header values. Covers parse options, formatting, validation boundaries, and migration away from older CommonJS/request-response examples.
---

Verified against content-type@3.0.0 on 2026-09-08. 5 of 5 examples executed.

# content-type

## Scope

This skill targets `content-type` `^3.0.0` (3.0.0). The package is ESM-only and requires Node.js `>=22`.

Import the package as an ESM namespace:

```ts pmcp-example
import * as assert from "node:assert/strict";
import * as contentType from "content-type";

const parsed = contentType.parse("image/svg+xml; charset=utf-8");

assert.equal(parsed.type, "image/svg+xml");
assert.equal(parsed.parameters.charset, "utf-8");
```

## Parse a Content-Type string

Use `parse(string, options?)`. The result contains `type` and `parameters`. Parameter names are lower case.

The parser is lenient and does not error. Validate the returned `type` and `parameters` before trusting them.

```ts pmcp-example
import * as assert from "node:assert/strict";
import * as contentType from "content-type";

const parsed = contentType.parse("Text/Plain; CHARSET=utf-8");

assert.equal(parsed.type, "text/plain");
assert.equal(parsed.parameters.charset, "utf-8");
```

## Parse options

The documented options are:

- `parameters: true` by default. Set it to `false` to skip parameters.
- `comma: false` by default. Set it to `true` to stop parsing at a comma.
- `start: 0` by default. Set it to the index from which parsing should begin.

```ts pmcp-example
import * as assert from "node:assert/strict";
import * as contentType from "content-type";

const withoutParameters = contentType.parse(
  "text/plain; charset=utf-8",
  { parameters: false },
);
assert.equal(withoutParameters.type, "text/plain");
assert.deepEqual(withoutParameters.parameters, {});

const firstValue = contentType.parse(
  "text/plain, application/json",
  { comma: true },
);
assert.equal(firstValue.type, "text/plain");

const fromOffset = contentType.parse(
  "prefix text/html; charset=utf-8",
  { start: "prefix ".length },
);
assert.equal(fromOffset.type, "text/html");
assert.equal(fromOffset.parameters.charset, "utf-8");
```

## Format a Content-Type value

Use `format({ type, parameters? })` to create a Content-Type header string. `parameters` is optional.

```ts pmcp-example
import * as assert from "node:assert/strict";
import * as contentType from "content-type";

assert.equal(
  contentType.format({
    type: "image/svg+xml",
    parameters: { charset: "utf-8" },
  }),
  "image/svg+xml; charset=utf-8",
);

assert.equal(
  contentType.format({ type: "application/json" }),
  "application/json",
);
```

`format` throws `TypeError` for an invalid media type or invalid parameter name. Treat this as validation at the formatting boundary rather than relying on the lenient parser to validate input.

```ts pmcp-example
import * as assert from "node:assert/strict";
import * as contentType from "content-type";

assert.throws(
  () => contentType.format({ type: "not a valid type" }),
  TypeError,
);

assert.throws(
  () => contentType.format({
    type: "text/plain",
    parameters: { "invalid parameter name": "value" },
  }),
  TypeError,
);
```

## Migration traps

- Do not use the older CommonJS shape (`require('content-type')`) with version 3.0.0. This release is ESM-only; use `import * as contentType from "content-type"`.
- Do not assume the older 1.x request/response overloads are part of the current documented API. The current documented call is `parse(string, options?)`, not `parse(req)` or `parse(res)`.
- Do not assume parsing validates input. The parser is documented as lenient and non-throwing; validate its returned `type` and `parameters` before trusting them.
- Do not treat repository development commands such as `build`, `test`, `specs`, `bench`, or `format` as application APIs.

## What this skill does not cover

The research does not specify the complete grammar accepted by the parser, every edge-case result for malformed input, exact error messages, TypeScript type details, or integration with HTTP request/response objects. It also does not cover a CLI or runner API; none is documented for this package.
