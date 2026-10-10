---
name: fast-check
description: Use fast-check 4.x for property-based testing in standalone JavaScript/TypeScript scripts, with v3-to-v4 migration guidance and runnable Bun examples.
---

Verified against fast-check@4.9.0 on 2026-09-08. 7 of 7 examples executed.

# fast-check 4.x

`fast-check` is a property-based testing library for JavaScript and TypeScript. This skill targets `^4.0.0`.

## Runtime and language requirements

- Node.js must be at least `12.17.0`.
- v4 targets ECMAScript 2020.
- TypeScript support is documented for TypeScript `5.0` or newer.
- Import the package as a namespace:

```ts pmcp-example
import * as fc from 'fast-check';
import assert from 'node:assert/strict';

const values = fc.sample(fc.nat(), 10);
assert.equal(values.length, 10);
assert.ok(values.every((value) => Number.isInteger(value) && value >= 0));
```

## Properties, preconditions, and assertions

Build a property with `fc.property(arbitrary1, arbitrary2, predicate)`, then run it with `fc.assert`. The predicate receives generated values and must return a truthy result. `fc.pre(condition)` discards a generated case when the precondition is not met; it is useful when the property only applies to part of an arbitrary's domain.

`fc.assert` throws when the property fails. It is synchronous for synchronous properties.

```ts pmcp-example
import * as fc from 'fast-check';
import assert from 'node:assert/strict';

function crop(text: string, maxLength: number): string {
  return text.slice(0, maxLength);
}

fc.assert(
  fc.property(fc.nat(), fc.string(), (maxLength, label) => {
    fc.pre(label.length <= maxLength);
    return crop(label, maxLength) === label;
  }),
  { seed: 42, numRuns: 20 },
);

assert.ok(true);
```

Use `fc.asyncProperty` for asynchronous predicates. Await `fc.assert`; otherwise a rejected promise can escape the intended control flow.

```ts pmcp-example
import * as fc from 'fast-check';
import assert from 'node:assert/strict';

const property = fc.asyncProperty(fc.nat(), async (value) => {
  await Promise.resolve();
  return value >= 0;
});

await fc.assert(property, { seed: 42, numRuns: 10 });
assert.ok(true);
```

## Inspecting runs with `check`

`fc.check` returns `RunDetails` instead of throwing immediately. The documented v4 result exposes `errorInstance` when a predicate fails; do not use the v3-shaped `error` field. Async checks must be awaited.

```ts pmcp-example
import * as fc from 'fast-check';
import assert from 'node:assert/strict';

const details = fc.check(
  fc.property(fc.constant(1), (value) => value === 1),
  { numRuns: 1, seed: 42 },
);

assert.equal(details.failed, false);
assert.equal(details.numRuns, 1);

const asyncDetails = await fc.check(
  fc.asyncProperty(fc.constant('ok'), async (value) => {
    await Promise.resolve();
    return value === 'ok';
  }),
  { numRuns: 1, seed: 42 },
);

assert.equal(asyncDetails.failed, false);
```

## Sampling arbitraries

`fc.sample(arbitrary, count)` extracts generated values. Passing `{ seed }` samples as though the run used that seed. The result is an array of generated values.

```ts pmcp-example
import * as fc from 'fast-check';
import assert from 'node:assert/strict';

const tenNaturals = fc.sample(fc.nat(), 10);
assert.equal(tenNaturals.length, 10);
assert.ok(tenNaturals.every((value) => value >= 0));

const first = fc.sample(fc.nat(), { seed: 42 });
const second = fc.sample(fc.nat(), { seed: 42 });
assert.deepEqual(first, second);
```

## Global configuration

`fc.configureGlobal(parameters)` changes default parameters used by subsequent operations, such as `numRuns`. A per-call parameter still applies to that call and can override the global setting. In a test framework, global configuration is typically placed in that framework's setup file; a standalone script can call it directly.

```ts pmcp-example
import * as fc from 'fast-check';
import assert from 'node:assert/strict';

fc.configureGlobal({ numRuns: 10 });

const details = fc.check(
  fc.property(fc.nat(), fc.nat(), (a, b) => a + b === b + a),
  { seed: 42 },
);

assert.equal(details.failed, false);
assert.equal(details.numRuns, 10);
```

## Common arbitraries and v4 inference

The documented API includes `anything`, `array`, `boolean`, `constant`, `constantFrom`, `nat`, `object`, `oneof`, `record`, `string`, and `tuple`, among others. `constant` and `constantFrom` have improved literal inference in v4: for example, `fc.constant('a')` is an `Arbitrary<'a'>`, and `fc.constantFrom('a', 'b')` is an `Arbitrary<'a' | 'b'>`.

```ts pmcp-example
import * as fc from 'fast-check';
import assert from 'node:assert/strict';

const literal = fc.constant('a');
const choice = fc.constantFrom('a', 'b');
const pair = fc.tuple(fc.boolean(), fc.nat());
const objectValue = fc.record({ name: fc.string(), enabled: fc.boolean() });

assert.equal(fc.sample(literal, 1)[0], 'a');
assert.ok(fc.sample(choice, 20).every((value) => value === 'a' || value === 'b'));
assert.equal(fc.sample(pair, 1)[0].length, 2);
assert.equal(typeof fc.sample(objectValue, 1)[0].enabled, 'boolean');
```

## v3-to-v4 migration traps

Do not copy older v3 examples without checking their options and names.

- Valid-only dates are no longer the default. Use `fc.date({ noInvalidDate: true })` to preserve the v3 behavior.
- Dictionaries and records no longer use the old default prototype behavior. Use `{ noNullPrototype: true }` with `fc.dictionary` or `fc.record` to preserve the v3 behavior.
- UUID generation changed defaults. Use `fc.uuid({ version: [1, 2, 3, 4, 5] })` to preserve v3 UUID versions.
- Replace `fc.record(model, { withDeletedKeys: true })` with `fc.record(model, { requiredKeys: [] })`.
- Removed or deprecated v3 names include `uuidV`, `unicodeJson*`, `ascii*`, `hexa*`, `base64`, `stringOf`, `char16bits`, `string16bits`, `fullUnicode*`, `unicode*`, `char`, `bigIntN`, `bigUintN`, `bigUint`, and `.noShrink`.
- Use `fc.noShrink(myArbitrary)` rather than the removed `.noShrink` shape.
- Use `fc.string({ unit: fc.constantFrom('Hello', 'World') })` rather than the removed string helpers.
- For bounded big integers, use `fc.bigInt({ min: 0n, max: (1n << BigInt(n)) - 1n })`.
- Predicate errors now retain the original error as `cause`. If v3-style reporting is required, use `includeErrorInReport`.
- Custom property runners must explicitly call `runBeforeEach` and `runAfterEach`.
- Custom `Arbitrary` implementations must not use the removed `Random.nextArrayInt`.

## What this skill does not cover

This skill does not cover every arbitrary, matcher, class, custom `Arbitrary` implementation, runner integration, or framework-specific setup API. It does not cover the complete `Random`, `Stream`, `Value`, or `Arbitrary` class APIs, advanced shrinking, failure-report formatting, or the full `Parameters` and `RunDetails` type definitions. fast-check is runner-agnostic; framework hooks and test-runner configuration are outside the documented standalone examples here.
