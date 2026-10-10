---
name: deep-eql
description: Use deep-eql ^5.0.0 for boolean deep comparisons in an ESM package. Covers the v5 export shape, comparison rules, custom comparators, circular references, and MemoizeMap.
---

Verified against deep-eql@5.0.2 on 2026-09-08. 7 of 7 examples executed.

# deep-eql ^5.0.0

## Import shape

Version 5 is an ES module (`"type": "module"`). Its default export is the comparison function, and `MemoizeMap` is a named export:

```ts pmcp-example
import deepEqual, { MemoizeMap } from 'deep-eql';
import assert from 'node:assert/strict';

assert.equal(typeof deepEqual, 'function');
assert.equal(typeof MemoizeMap, 'function');
assert.equal(deepEqual({ a: 1 }, { a: 1 }), true);
```

Do not apply the v4 CommonJS shape (`require('deep-eql')`, `module.exports`, or a direct CommonJS default assumption) to v5 code. The inspected v5 package uses `export default deepEqual` and `export var MemoizeMap`.

## Default deep equality

Call the default export with two operands and optionally an options object. The result is a boolean. Primitive comparison follows `Object.is`-style behavior: `NaN` equals `NaN`, while `-0` and `+0` do not.

```ts pmcp-example
import deepEqual from 'deep-eql';
import assert from 'node:assert/strict';

assert.equal(deepEqual({ a: 1, nested: { b: 2 } }, { a: 1, nested: { b: 2 } }), true);
assert.equal(deepEqual(NaN, NaN), true);
assert.equal(deepEqual(-0, +0), false);
```

The comparison includes inherited enumerable properties. `Error` values are compared using their `name`, `message`, and `code`; different error types are not equal. Typed arrays, sets, and maps are supported by the built-in algorithm.

```ts pmcp-example
import deepEqual from 'deep-eql';
import assert from 'node:assert/strict';

assert.equal(deepEqual(Error('foo'), Error('foo')), true);
assert.equal(deepEqual(Error('foo'), TypeError('foo')), false);
assert.equal(deepEqual(new Uint8Array([1]), new Uint8Array([1])), true);
assert.equal(deepEqual(new Set([1]), new Set([1])), true);
assert.equal(deepEqual(new Map([['a', 1]]), new Map([['a', 1]])), true);

const prototype = { inherited: { value: 1 } };
const left = Object.create(prototype);
const right = Object.create({ inherited: { value: 1 } });
assert.equal(deepEqual(left, right), true);
```

`Arguments` is not treated as an Array. To compare an `Arguments` value as an Array, convert it to an Array first; the converted value must contain the same elements as the Array being compared.

```ts pmcp-example
import deepEqual from 'deep-eql';
import assert from 'node:assert/strict';

function makeArguments() {
  return arguments;
}

const args = makeArguments();
assert.equal(deepEqual([], args), false);
assert.equal(deepEqual([], Array.prototype.slice.call(args)), true);
```

## Custom comparator

Pass `options.comparator` to override the default algorithm. It receives both operands and may return `true`, `false`, or `null`. Returning `null` delegates that comparison back to the default algorithm.

```ts pmcp-example
import deepEqual from 'deep-eql';
import assert from 'node:assert/strict';

const result = deepEqual(1, '1', {
  comparator: (leftHandOperand, rightHandOperand) => {
    if (leftHandOperand == rightHandOperand) return true;
    return null;
  }
});

assert.equal(result, true);
```

Use a definite `false` when the comparator should reject a pair; use `null`, not `undefined`, when the built-in comparison should continue.

## Circular references and memoization

The `memoize` option accepts a custom memoization object. Supplying one allows circular structures to be compared without infinite recursion:

```ts pmcp-example
import deepEqual from 'deep-eql';
import assert from 'node:assert/strict';

const left = {};
left.self = left;

const right = {};
right.self = right;

assert.equal(deepEqual(left, right, { memoize: new WeakMap() }), true);
```

Passing `memoize: false` disables memoization. Do not do that for circular references: the inspected implementation documents that circular structures then blow the stack.

## `MemoizeMap`

`MemoizeMap` is the package's memoization implementation: it is `WeakMap` when available and otherwise the package fallback `FakeMap`. Instantiate it when you need the package-selected memoization object.

```ts pmcp-example
import deepEqual, { MemoizeMap } from 'deep-eql';
import assert from 'node:assert/strict';

const left = {};
left.self = left;

const right = {};
right.self = right;

const memoize = new MemoizeMap();
assert.equal(deepEqual(left, right, { memoize }), true);
```

## What this skill does not cover

The research does not cover the full comparison algorithm for every built-in type, detailed comparator invocation order, the fallback `FakeMap` API beyond its use as `MemoizeMap`, browser-specific behavior, or changes in later 5.x releases. It also does not cover package development scripts or test-runner integration; the package API is directly callable from a script.
