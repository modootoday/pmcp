---
name: chai
description: Use Chai 6 as an ESM-only assertion library, including its expect, assert, should, plugin, configuration, and Assertion extension surfaces.
---

Verified against chai@6.2.2 on 2026-09-08. 5 of 5 examples executed.

# Chai 6

## Runtime and module shape

Chai 6 is ESM-only and requires Node.js 18 or newer. Import the public API from `chai`:

```ts
import { assert, expect, should } from 'chai';
```

The published package exposes `index.js` and the `register-*` entry points. It no longer publishes the old `lib/` files or the older standalone `chai.js` bundle.

Do not import Chai internals such as `chai/lib/chai.js`. In Chai 6, the only package file intended for direct import is `index.js`, accessed through the package's public exports.

## Assertion styles

Chai exposes three styles:

- `assert`: function-based assertions
- `expect`: chained assertions
- `should`: a function that modifies `Object.prototype` to provide `.should` assertions

Use only the style needed by the code. `should()` is global-ish because it modifies `Object.prototype`; avoid it when that mutation is undesirable.

### `assert`

```ts pmcp-example
import nodeAssert from 'node:assert/strict';
import { assert } from 'chai';

assert('foo' !== 'bar', 'foo is not bar');
assert(Array.isArray([]), 'empty arrays are arrays');

nodeAssert.equal(1 + 1, 2);
```

### `expect`

```ts pmcp-example
import nodeAssert from 'node:assert/strict';
import { expect } from 'chai';

expect('foo').to.be.a('string');
expect([1, 2, 3]).to.have.lengthOf(3);

nodeAssert.ok(true);
```

### `should`

Call `should()` before using the `.should` property. This modifies `Object.prototype` for the process.

```ts pmcp-example
import nodeAssert from 'node:assert/strict';
import { should } from 'chai';

should();
'foo'.should.be.a('string');

nodeAssert.ok(true);
```

## Plugins

Load plugins explicitly with `use(plugin)`. A plugin receives an object containing Chai's public facilities, including `use`, `AssertionError`, `util`, `config`, `expect`, `assert`, `Assertion`, and the `should` exports. `use` returns that object.

```ts pmcp-example
import nodeAssert from 'node:assert/strict';
import { expect, use } from 'chai';

let called = false;
const api = use((provided) => {
  called = provided.expect === expect &&
    provided.use === use &&
    typeof provided.Assertion === 'function';
});

nodeAssert.equal(called, true);
nodeAssert.equal(api.expect, expect);
```

For an external ESM plugin, import both Chai and the plugin, then register it explicitly:

```ts
import * as chai from 'chai';
import { default as chaiHttp } from 'chai-http';

chai.use(chaiHttp);
```

The plugin package must be installed separately. Do not assume a plugin is automatically registered.

## Extending `Assertion`

The public `Assertion` export provides extension methods for plugins and custom assertions:

```ts
import { Assertion } from 'chai';
```

The supported extension registration methods are:

- `Assertion.addProperty(name, fn)`
- `Assertion.addMethod(name, fn)`
- `Assertion.addChainableMethod(name, fn, chainingBehavior)`
- `Assertion.overwriteProperty(name, fn)`
- `Assertion.overwriteMethod(name, fn)`
- `Assertion.overwriteChainableMethod(name, fn, chainingBehavior)`

`Assertion` can also be constructed with `(value, message, ssfi, lockSsfi)`. Prefer using the normal `expect`, `assert`, or `should` interfaces unless you are implementing an extension.

## Configuration

The public `config` export contains Chai configuration. The researched configuration properties are `includeStack` and `showDiff`:

```ts pmcp-example
import nodeAssert from 'node:assert/strict';
import { config } from 'chai';

config.includeStack = false;
config.showDiff = true;

nodeAssert.equal(config.includeStack, false);
nodeAssert.equal(config.showDiff, true);
```

Configuration is process-wide for the imported Chai instance, so set it deliberately when multiple components share the process.

## Register entry points

Chai publishes these package subpaths:

```ts
import 'chai/register-assert';
import 'chai/register-expect';
import 'chai/register-should';
```

They are preload entry points intended for a runner or CLI, such as a runner's `--require` option. They are not assertion APIs themselves. In a directly executed `bun example.ts`, import and call `assert`, `expect`, or `should` from `chai` instead.

## Common migration mistakes

- **Using CommonJS or assuming a default Chai import:** Chai 6 is ESM-only. Use named imports from `chai`.
- **Importing old internal paths:** Chai 5 code and repository examples may refer to `lib/*.js`. Those files are not published in Chai 6; use the top-level public exports.
- **Expecting the old package layout:** Chai 5.3.2 published `chai.js`, `index.js`, `lib/`, and registration files. Chai 6 publishes only `index.js` and the registration entry points.
- **Treating `register-*` as assertion functions:** registration files are runner/CLI preload modules. Direct scripts need the public imports.
- **Assuming plugins load automatically:** call `use(plugin)` explicitly.
- **Forgetting the side effect of `should()`:** it modifies `Object.prototype`; call it only when that global-style behavior is intended.
- **Running on an unsupported Node version:** Chai 6 declares Node `>=18`.

## Not covered by this skill

This skill does not cover individual Chai assertion methods beyond the examples shown, the implementation of custom assertion callbacks, plugin-specific APIs, runner configuration, CLI usage, browser bundler configuration, or rebuilding Chai from repository source. It also does not cover the additional function/class-name preservation fix introduced in Chai 6.0.1.
