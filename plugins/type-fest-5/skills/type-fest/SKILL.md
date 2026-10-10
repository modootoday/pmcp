---
name: type-fest
description: Use type-fest v5.0.0 as a strict, type-only utility package. Covers v5 module/configuration requirements, the documented Except and Tagged APIs, and migration traps from v4.
---

Verified against type-fest@5.9.0 on 2026-09-08. 3 of 3 examples executed.

# type-fest v5

`type-fest` v5.0.0 is a type-only package. It exports TypeScript declarations from the package root; it does not provide runtime functions. Use it from TypeScript with TypeScript `>=5.9`, `{strict: true}`, and an ESM setup. The package declares Node `>=20` and is pure ESM.

## Importing

Use type-only imports from the package root:

```ts
import type {Except, Tagged} from 'type-fest';
```

The package has no documented runtime API. Do not write a plain-script example that expects an imported function, constructor, or runtime value. TypeScript's compiler or type-aware tooling must consume the declarations. The examples below are standalone Bun scripts: their runtime assertions only verify that the type-only code erases cleanly, while the assignments demonstrate the intended compile-time types.

## `Except`

`Except<ObjectType, KeysType, Options>` removes selected keys from an object type. `KeysType` must extend `keyof ObjectType`.

```ts pmcp-example
import assert from 'node:assert/strict';
import type {Except} from 'type-fest';

type Foo = {
	a: number;
	b: string;
};

type FooWithoutA = Except<Foo, 'a'>;

const value: FooWithoutA = {b: '2'};
assert.deepEqual(value, {b: '2'});
```

The older, commonly shown usage shape remains valid in v5:

```ts
import type {Except} from 'type-fest';

type Foo = {unicorn: string; rainbow: boolean};
type FooWithoutRainbow = Except<Foo, 'rainbow'>;
```

Do not treat `Except` as a runtime object-filtering function. It changes only the static type; it does not remove properties from a JavaScript value.

## Tagged types

`Tagged<Type, TagName, TagMetadata>` creates a branded type while retaining the underlying `Type`. Different tags prevent accidental interchangeability even when their underlying types are identical.

```ts pmcp-example
import assert from 'node:assert/strict';
import type {Tagged} from 'type-fest';

type AccountNumber = Tagged<number, 'AccountNumber'>;
type AccountBalance = Tagged<number, 'AccountBalance'>;

function createAccountNumber(): AccountNumber {
	return 2 as AccountNumber;
}

function getMoneyFor(accountNumber: AccountNumber): AccountBalance {
	assert.equal(accountNumber, 2);
	return 4 as AccountBalance;
}

const accountNumber = createAccountNumber();
const balance = getMoneyFor(accountNumber);
assert.equal(balance, 4);
assert.equal(accountNumber + 2, 4);
```

The tag is compile-time-only. Arithmetic and other operations on the underlying value remain possible, but an untagged `number` or a differently tagged number is not accepted where `AccountNumber` is required.

### Metadata, `GetTagMetadata`, and `UnwrapTagged`

A tag can carry metadata as its third parameter. `GetTagMetadata<Type, TagName>` retrieves metadata for a tag, and `UnwrapTagged<TaggedType>` removes all tags and returns the underlying type.

```ts pmcp-example
import assert from 'node:assert/strict';
import type {GetTagMetadata, Tagged, UnwrapTagged} from 'type-fest';

type JsonOf<T> = Tagged<string, 'JSON', T>;

function stringify<T>(value: T): JsonOf<T> {
	return JSON.stringify(value) as JsonOf<T>;
}

function parse<T extends JsonOf<unknown>>(value: T): GetTagMetadata<T, 'JSON'> {
	return JSON.parse(value) as GetTagMetadata<T, 'JSON'>;
}

const encoded = stringify({hello: 'world'});
const parsed: {hello: string} = parse(encoded);
assert.deepEqual(parsed, {hello: 'world'});

const plain: UnwrapTagged<typeof encoded> = 'encoded JSON';
assert.equal(plain, 'encoded JSON');
```

`Tagged` does not serialize a tag or metadata into the value. The `JSON` example uses casts at the serialization boundary because the type information is represented only in TypeScript.

## Other exports

The v5 root re-exports many declaration-only utilities, including `PackageJson`, `ArraySlice`, `CamelCase`, `Jsonify`, `Merge`, `Paths`, and `SetReturnType`. They are types rather than runtime helpers. This skill does not infer their exact parameters or behavior beyond the researched surface above.

## v5 migration traps

- v5 is pure ESM and declares `"type": "module"`. It requires Node `>=20` and TypeScript `>=5.9`; configure TypeScript with `{strict: true}`.
- The v4 name `StringKeyOf` was renamed to `KeyAsString` in v5:
  ```ts
  // v4
  import type {StringKeyOf} from 'type-fest';

  // v5
  import type {KeyAsString} from 'type-fest';
  ```
- `ObservableLike` moved to the `./globals` sub-export. The package also documents the `If*` types as deprecated in favor of `If`.
- `ArrayTail` preserves `readonly` by default in v5 and no longer uses `preserveReadonly`.
- Naming-case types disable `preserveConsecutiveUppercase` by default.
- `PartialDeep` disables `allowUndefinedInNonTupleArrays` by default.
- `Split` enables `strictLiteralChecks` by default.
- `Paths` defaults `maxRecursionDepth` to `5`, rather than v4's `10`.

## Not covered

This skill does not cover the exact signatures or usage of the other root exports, the `./globals` declarations beyond the `ObservableLike` move, compiler configuration beyond the researched v5 requirements, or behavior of any runtime tool. type-fest itself exposes no documented runtime API; the remaining surface must be checked through TypeScript's compiler or type-aware tooling.
