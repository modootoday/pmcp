---
name: ow
description: Use ow ^3.0.0 for runtime validation in Node.js 20+ ESM code. Covers the v3 API, validation results, predicates, modifiers, custom predicates, TypeScript inference, and v2-to-v3 migration traps.
---

Verified against ow@3.1.1 on 2026-09-08. 4 of 4 examples executed.

# ow

Use this skill for `ow` version `^3.0.0` (the v3 API is documented against 3.1.1). The package is ESM-only and requires Node.js 20 or newer.

## Import and core operations

```ts
import ow from 'ow';
```

The main callable validates a value and throws `ArgumentError` when validation fails:

```ts
ow(value, predicate);
ow(value, label, predicate);
```

Use the other entry points according to the desired failure behavior:

- `ow.isValid(value, predicate)` returns a boolean.
- `ow.validate(value, predicate)` returns `{success: true, value}` or `{success: false, error}`.
- `ow.validate(value, label, predicate)` is the labeled form.
- `ow.create(predicate)` and `ow.create(label, predicate)` create reusable validation functions.
- `ow.any(...predicates)` accepts a value matching any supplied predicate.
- `ow.isPredicate(value)` identifies an ow predicate.

```ts pmcp-example
import ow, {ArgumentError} from 'ow';
import assert from 'node:assert/strict';

assert.doesNotThrow(() => ow('hello', ow.string.minLength(5)));
assert.throws(
	() => ow('no', 'username', ow.string.minLength(5)),
	error => error instanceof ArgumentError,
);

assert.equal(ow.isValid(123, ow.number), true);
assert.equal(ow.isValid('123', ow.number), false);

const valid = ow.validate('hello', ow.string);
assert.equal(valid.success, true);
if (valid.success) {
	assert.equal(valid.value.length, 5);
}

const invalid = ow.validate(123, 'name', ow.string);
assert.equal(invalid.success, false);
if (!invalid.success) {
	assert.ok(invalid.error instanceof ArgumentError);
}

const longString = ow.create('value', ow.string.minLength(3));
assert.doesNotThrow(() => longString('abc'));
assert.throws(() => longString('a'), ArgumentError);

assert.equal(ow.isPredicate(ow.string), true);
assert.equal(ow.isPredicate('string'), false);
assert.equal(ow.isValid('abc', ow.any(ow.number, ow.string)), true);
assert.equal(ow.isValid(true, ow.any(ow.number, ow.string)), false);
```

## Built-in predicates and modifiers

The documented built-in predicates include `string`, `number`, `boolean`, `array`, `function`, `object`, `date`, `promise`, `map`, `set`, typed-array predicates, `arrayBuffer`, `dataView`, `nan`, `nullOrUndefined`, `iterable`, and `typedArray`.

Use modifiers such as `ow.optional.{type}`, `ow.nullable.{type}`, and `ow.absent.{type}` where the corresponding presence/nullability behavior is required. Predicate modifiers are chainable, for example `.minLength()`, `.maxLength()`, `.not`, `.empty`, and `.is()`.

```ts pmcp-example
import ow from 'ow';
import assert from 'node:assert/strict';

assert.equal(ow.isValid('abc', ow.string.minLength(3).maxLength(5)), true);
assert.equal(ow.isValid('', ow.string.not.empty), false);
assert.equal(ow.isValid(7, ow.number.is(value => value < 10)), true);
assert.equal(ow.isValid(10, ow.number.is(value => value < 10)), false);

assert.equal(ow.isValid('red', ow.any(ow.string, ow.number)), true);
assert.equal(ow.isValid(4, ow.any(ow.string, ow.number)), true);
assert.equal(ow.isValid(false, ow.any(ow.string, ow.number)), false);

assert.equal(ow.isValid(1, ow.optional.number), true);
assert.equal(ow.isValid(undefined, ow.optional.number), true);
assert.equal(ow.isValid(null, ow.nullable.number), true);
assert.equal(ow.isValid(undefined, ow.nullable.number), false);

assert.equal(ow.isValid(new Uint8Array([1, 2]), ow.uint8Array), true);
assert.equal(ow.isValid(new ArrayBuffer(2), ow.arrayBuffer), true);
```

`ow.absent` is documented as a modifier for presence-sensitive validation, but the research does not establish a standalone value-level example for its semantics. Do not infer its behavior from `ow.optional` or `ow.nullable`.

## Custom predicates

Use `.is()` for a predicate based on a boolean callback. Use `.validate()` when the callback should return a custom validator result and message.

```ts pmcp-example
import ow from 'ow';
import assert from 'node:assert/strict';

const underTen = ow.number.is(value => value < 10);
assert.equal(ow.isValid(9, underTen), true);
assert.equal(ow.isValid(10, underTen), false);

const greaterThanTen = ow.number.validate(value => ({
	validator: value > 10,
	message: `Expected value to be greater than 10, got ${value}`,
}));

assert.equal(ow.isValid(11, greaterThanTen), true);
const result = ow.validate(10, greaterThanTen);
assert.equal(result.success, false);
if (!result.success) {
	assert.match(result.error.message, /greater than 10/);
}
```

## Shapes and TypeScript inference

Object shape validation is available through `ow.object.exactShape()`. `Infer` derives a TypeScript type from a predicate, while `ValidateResult` and the other named exports are type exports.

```ts pmcp-example
import ow, {type Infer} from 'ow';
import assert from 'node:assert/strict';

const userPredicate = ow.object.exactShape({
	name: ow.string,
});

type User = Infer<typeof userPredicate>;
const user: User = {name: 'Ada'};

assert.equal(ow.isValid(user, userPredicate), true);
assert.equal(ow.isValid({name: 123}, userPredicate), false);
```

String literal predicates can narrow with `string.equals()` and `string.oneOf()` in TypeScript. For example, a value validated by `ow.string.oneOf(['red', 'blue'])` can be returned as the literal union `'red' | 'blue'` after validation.

## v3 migration traps

- Do not use `ow.buffer`. It was removed in v3; use `ow.uint8Array` instead.
- Predicates are immutable in v3. Do not rely on a modifier changing an existing predicate; use the returned predicate when chaining.
- The package requires Node.js 20 or newer.
- The familiar v2 call shapes still apply: `ow(value, predicate)`, `ow(value, label, predicate)`, `ow.isValid()`, `ow.create()`, and `ow.any()`.
- Prefer `ow.validate()` when failure is expected and should be handled as data rather than caught as an exception.

## Development-only entry point

The package also exports `ow/dev-only`. The documentation describes it for a bundler/build step that replaces the implementation in production, such as a Parcel production build with `NODE_ENV="production"`. It is not documented as a plain-script optimization, so use the normal `ow` import in standalone scripts.

## Not covered

This skill does not cover the complete predicate catalog or every predicate modifier, the exact runtime shape of all built-in error messages, bundler configuration beyond the documented `ow/dev-only` boundary, or framework/test-runner integration. The research also does not document the full object-shape syntax beyond `exactShape`, the precise standalone semantics of `absent`, or the details of every exported type.
