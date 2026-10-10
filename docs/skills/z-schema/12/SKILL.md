---
name: z-schema
description: Use z-schema ^12.0.0 for JSON Schema validation with synchronous and asynchronous APIs, safe results, draft-aware schemas, custom formats, and registered remote references.
---

Verified against z-schema@12.4.5 on 2026-09-08. 7 of 7 examples executed.

# z-schema ^12.0.0

## Runtime and defaults

- z-schema v12 requires Node.js 22 or later.
- Use `ZSchema.create()` rather than constructing `ZSchema` directly. Older examples may still show `new ZSchema(...)`.
- The default JSON Schema dialect is `draft2020-12`. Draft-2019-09, draft-07, draft-06, and draft-04 are also supported.
- Existing draft-04, draft-06, and draft-07 schemas must either declare `$schema` or use a matching factory option such as `{ version: 'draft-07' }`.
- In draft-2019-09 and draft-2020-12, `format` is annotation-only by default. `{ formatAssertions: null }` restores legacy assertion behavior; `{ formatAssertions: true }` enables vocabulary-aware assertions.

## Synchronous validation

The default validator throws when validation fails. A successful call returns `true`.

```ts pmcp-example
import assert from 'node:assert/strict';
import ZSchema from 'z-schema';

const validator = ZSchema.create();
const schema = {
  type: 'object',
  properties: { answer: { type: 'number' } },
  required: ['answer'],
  additionalProperties: false,
};

assert.equal(validator.validate({ answer: 42 }, schema), true);

try {
  validator.validate({ answer: 'wrong' }, schema);
  assert.fail('validation should throw');
} catch (error) {
  assert.equal((error as Error).name, 'ValidateError');
  assert.ok(Array.isArray((error as { details: unknown[] }).details));
}
```

Do not expect the old boolean-plus-`getLastErrors()` behavior. The removed public methods include `getLastError()`, `getLastErrors()`, `isValid()`, `compileSchema()`, `getMissingReferences()`, `getMissingRemoteReferences()`, and `getResolvedSchema()`.

## Safe validation

Use `{ safe: true }` when failure should be returned rather than thrown. The result is `{ valid: true }` or `{ valid: false, err }`.

```ts pmcp-example
import assert from 'node:assert/strict';
import ZSchema from 'z-schema';

const validator = ZSchema.create({ safe: true });
const schema = { type: 'string' };

const good = validator.validate('ok', schema);
assert.deepEqual(good, { valid: true });

const bad = validator.validate(123, schema);
assert.equal(bad.valid, false);
if (bad.valid) throw new Error('expected invalid result');
assert.ok(Array.isArray(bad.err.details));
```

`validateSafe()` and `validateSchemaSafe()` are also available. `validateSchema()` and `validateSchemaSafe()` validate schema documents themselves rather than instance data.

```ts pmcp-example
import assert from 'node:assert/strict';
import ZSchema from 'z-schema';

const validator = ZSchema.create();
const schema = { type: 'object', required: ['name'] };

assert.equal(validator.validateSchema(schema), true);
const result = validator.validateSchemaSafe({ type: 17 });
assert.equal(result.valid, false);
```

## Draft-version migration

Version 12 changed the default from draft-07 to draft-2020-12. Select an older draft explicitly when using its schema vocabulary:

```ts pmcp-example
import assert from 'node:assert/strict';
import ZSchema from 'z-schema';

const validator = ZSchema.create({ version: 'draft-07' });
const schema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'array',
  items: [{ type: 'string' }],
  additionalItems: false,
};

assert.equal(validator.validate(['value'], schema), true);
```

When migrating schemas to draft-2020-12, the vocabulary shapes differ:

- `id` becomes `$id`.
- `definitions` becomes `$defs`.
- Tuple `items: [...]` becomes `prefixItems`.
- `additionalItems` becomes `items` alongside `prefixItems`.
- `dependencies` becomes either `dependentSchemas` or `dependentRequired`.

Version 12 also supports `unevaluatedProperties`, `unevaluatedItems`, `$dynamicRef`, and `$dynamicAnchor`.

## Asynchronous validation

Create the validator with `{ async: true }`. Its validation methods return promises. With `{ async: true, safe: true }`, the promise resolves to a safe result rather than rejecting for validation failure.

```ts pmcp-example
import assert from 'node:assert/strict';
import ZSchema from 'z-schema';

const validator = ZSchema.create({ async: true });
assert.equal(await validator.validate('ok', { type: 'string' }), true);

const safe = ZSchema.create({ async: true, safe: true });
const result = await safe.validate(123, { type: 'string' });
assert.equal(result.valid, false);
```

The explicit methods are `validateAsync()` and `validateAsyncSafe()`. Async format validators require the async factory option; do not call an async validator through a synchronous validator.

## Custom formats

Formats can be registered on a validator. The package also exports format-management helpers, including `registerFormat`, `unregisterFormat`, `getRegisteredFormats`, `getSupportedFormats`, `getFormatValidators`, and `isFormatSupported`.

```ts pmcp-example
import assert from 'node:assert/strict';
import ZSchema from 'z-schema';

const validator = ZSchema.create({ formatAssertions: true });
validator.registerFormat('uppercase', (value: unknown): boolean =>
  typeof value === 'string' && value === value.toUpperCase(),
);

const schema = { type: 'string', format: 'uppercase' };
assert.equal(validator.validate('YES', schema), true);
```

For draft-2019-09 and draft-2020-12, registering a format does not by itself make `format` an assertion under the default settings. Configure `formatAssertions` when format failures must invalidate data. The format-management functions are also available as package exports.

## Remote references

Register a remote schema before validating a `$ref` that points to it. In v12, `setRemoteReference()` is a static API; older examples that call it on an instance are outdated.

```ts pmcp-example
import assert from 'node:assert/strict';
import ZSchema from 'z-schema';

ZSchema.setRemoteReference('https://example.test/person.json', {
  $id: 'https://example.test/person.json',
  type: 'object',
  required: ['name'],
  properties: { name: { type: 'string' } },
});

const validator = ZSchema.create();
const schema = { $ref: 'https://example.test/person.json' };
assert.equal(validator.validate({ name: 'Ada' }, schema), true);
```

A schema reader can be installed with `ZSchema.setSchemaReader(...)` and inspected with `ZSchema.getSchemaReader()`. A reader is responsible for resolving the URI; remote references otherwise need registration before validation.

## Recursion

The default recursion limit is 100. Deep recursive validation can produce `MAX_RECURSION_DEPTH_EXCEEDED`; increase it with `{ maxRecursionDepth: 500 }` when the schema and data require a deeper limit.

## What this skill does not cover

- The command-line executable and its file-oriented invocation.
- Browser use of the published UMD bundle.
- Detailed error-code and error-parameter catalogs.
- Building a filesystem-backed `SchemaReader`.
- The complete TypeScript type surface beyond the public APIs described here.
