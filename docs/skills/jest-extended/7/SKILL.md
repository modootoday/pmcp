---
name: jest-extended
description: Use jest-extended v7 matchers with a Jest/Vitest-compatible expect.extend host, and understand the small subset that can be exercised directly without a test runner.
---

Verified against jest-extended@7.0.0 on 2026-09-08. 3 of 3 examples executed.

# jest-extended v7

## What this package is

`jest-extended` v7 provides additional Jest matchers. Its package entry point re-exports the matchers from `./matchers`.

The documented integration is with Jest's `expect.extend`:

```ts
import * as matchers from 'jest-extended';
expect.extend(matchers);
```

Selective registration is also supported:

```ts
import { toBeArray, toBeSealed } from 'jest-extended';
expect.extend({ toBeArray, toBeSealed });
```

The package does not provide a standalone assertion runner. `describe`, `it`, and `expect` are not supplied by the package in a directly executed script. Vitest can use the same matchers through Vitest's compatible `expect.extend` API and a setup file.

## Exported matcher surface

The v7 entry point exports:

- `fail`, `pass`
- Type/value matchers: `toBeArray`, `toBeArrayOfSize`, `toBeBigInt`, `toBeBoolean`, `toBeDate`, `toBeDateString`, `toBeEmpty`, `toBeEmptyObject`, `toBeEven`, `toBeExtensible`, `toBeFalse`, `toBeFinite`, `toBeFrozen`, `toBeFunction`, `toBeHexadecimal`, `toBeInteger`, `toBeNaN`, `toBeNegative`, `toBeNil`, `toBeNumber`, `toBeObject`, `toBeOdd`, `toBeOneOf`, `toBePositive`, `toBeSealed`, `toBeString`, `toBeSymbol`, `toBeTrue`, `toBeValidDate`
- Range/date matchers: `toBeAfter`, `toBeAfterOrEqualTo`, `toBeBefore`, `toBeBeforeOrEqualTo`, `toBeBetween`, `toBeWithin`, `toBeInRange`
- Collection/content matchers: `toContainAllEntries`, `toContainAllKeys`, `toContainAllValues`, `toContainAnyEntries`, `toContainAnyKeys`, `toContainAnyValues`, `toContainEntries`, `toContainEntry`, `toContainKey`, `toContainKeys`, `toContainValue`, `toContainValues`, `toInclude`, `toIncludeAllMembers`, `toIncludeAllPartialMembers`, `toIncludeSamePartialMembers`, `toIncludeAnyMembers`, `toIncludeMultiple`, `toIncludeRepeated`, `toIncludeSameMembers`, `toPartiallyContain`
- String/predicate matchers: `toEndWith`, `toEqualCaseInsensitive`, `toEqualIgnoringWhitespace`, `toSatisfy`, `toSatisfyAll`, `toSatisfyAny`, `toStartWith`
- Change/spy/promise/error matchers: `toChange`, `toChangeBy`, `toChangeTo`, `toHaveBeenCalledAfter`, `toHaveBeenCalledBefore`, `toHaveBeenCalledOnce`, `toHaveBeenCalledExactlyOnceWith`, `toReject`, `toResolve`, `toThrowWithMessage`

## Directly exercising matchers without a runner

The matcher functions themselves can be imported and called with a matcher context. A direct script must provide the `this.utils` methods the matcher uses; this tests the matcher result, not a Jest assertion environment.

`toBeArray` uses `Array.isArray`, so arrays pass and other values fail.

```ts pmcp-example
import assert from 'node:assert/strict';
import { toBeArray } from 'jest-extended';

const context = {
  utils: {
    matcherHint: (hint: string) => hint,
    printReceived: (value: unknown) => String(value),
  },
};

const isArray = (toBeArray as any).call(context, [1, 2]);
const isNotArray = (toBeArray as any).call(context, 'not an array');

assert.equal(isArray.pass, true);
assert.equal(isNotArray.pass, false);
```

`toInclude` only passes when the received value is a string containing the expected string. It does not use array membership semantics.

```ts pmcp-example
import assert from 'node:assert/strict';
import { toInclude } from 'jest-extended';

const context = {
  utils: {
    matcherHint: (hint: string) => hint,
    printReceived: (value: unknown) => String(value),
    printExpected: (value: unknown) => String(value),
  },
};

const included = (toInclude as any).call(context, 'hello world', 'world');
const absent = (toInclude as any).call(context, 'hello world', 'mars');
const wrongType = (toInclude as any).call(context, ['hello', 'world'], 'world');

assert.equal(included.pass, true);
assert.equal(absent.pass, false);
assert.equal(wrongType.pass, false);
```

`toBeWithin` uses an inclusive start and exclusive end. It accepts numbers and bigints according to its type check. Keep the operand types compatible with JavaScript comparisons.

```ts pmcp-example
import assert from 'node:assert/strict';
import { toBeWithin } from 'jest-extended';

const context = {
  utils: {
    matcherHint: (hint: string) => hint,
    printReceived: (value: unknown) => String(value),
    printExpected: (value: unknown) => String(value),
  },
};

const atStart = (toBeWithin as any).call(context, 10, 10, 20);
const atEnd = (toBeWithin as any).call(context, 20, 10, 20);
const bigintValue = (toBeWithin as any).call(context, 15n, 10n, 20n);
const wrongType = (toBeWithin as any).call(context, '15', 10, 20);

assert.equal(atStart.pass, true);
assert.equal(atEnd.pass, false);
assert.equal(bigintValue.pass, true);
assert.equal(wrongType.pass, false);
```

## Setup mistakes to avoid

- Do not call `expect(...)` in a plain script unless you supply a compatible `expect` host. The package supplies matchers, not the runner or assertion global.
- Do not assume importing the package automatically installs every matcher. Register all matchers with `expect.extend(matchers)`, or register selected named exports.
- Do not treat `jest-extended/all` as a standalone implementation. Its v7 entry point forwards to the built `dist/all` output and is intended for Jest setup configuration such as `setupFilesAfterEnv`.
- Do not use the old `toHaveBeenCalledOnceWith` name. It was renamed in an earlier major to `toHaveBeenCalledExactlyOnceWith`.
- BigInt support and the `toBeBigInt` matcher were added in v6; code targeting older versions may show a shape that does not reflect v7.
- v7's documented Jest support is Jest `27.2.5` and newer. The package metadata declares Jest as an optional peer and TypeScript as a peer, with TypeScript `>=5.0.0`.
- v7 changed the supported Node engine range: it drops Node 18 and Node 23 and adds Node 24 and 25 support. Its published engine range is `^20.9.0 || ^22.11.0 || ^24.11.0 || >=25.0.0`.

## What this skill does not cover

The supplied research does not document the argument semantics or implementation behavior of most exported matchers beyond the three shown above. It also does not cover Jest configuration details beyond the setup-file pattern, matcher failure formatting in a real Jest run, TypeScript declaration usage, Vitest version compatibility, or the behavior of `fail`, `pass`, spies, promises, changes, dates, objects, collections, and predicate matchers. Those parts should be exercised through the compatible Jest/Vitest host or verified from their individual v7 implementations.
