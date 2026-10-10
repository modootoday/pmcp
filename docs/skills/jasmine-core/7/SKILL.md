---
name: jasmine-core
description: Use jasmine-core ^7.0.0 directly from Node: install its globals into a chosen object, inspect the core version, reset shared state, and define Jasmine specs, expectations, spies, and not-applicable specs. It is not the Jasmine CLI or test runner.
---

Verified against jasmine-core@7.0.2 on 2026-09-08. 5 of 5 examples executed.

# jasmine-core 7.x

## What this package is

`jasmine-core` is the Jasmine core/assets package. In Node, importing it returns an automatically-created core instance. The same instance is returned on every import. Node does not install globals automatically.

Node test discovery, test-file loading, configuration, and terminal execution belong to the separate `jasmine` package. Browser execution belongs to the browser tooling. This package alone is not a CLI runner.

## Import and booting in 7.x

```js
const jasmineCore = require('jasmine-core');
```

The module exposes the documented module members and the Jasmine globals. It does **not** expose `boot`, `noGlobals`, or `jasmineRequire`.

Install globals explicitly when a script needs the global Jasmine API:

```js
jasmineCore.installGlobals();
```

`installGlobals(dest)` copies the Jasmine globals to `dest`; if `dest` is omitted, it uses `globalThis`. The exported globals include `describe`, `it`, `expect`, `expectAsync`, lifecycle hooks, spy helpers, pending/focused/disabled spec helpers, spec-property helpers, `throwUnless`, and `notApplicable`.

```ts pmcp-example
import assert from "node:assert/strict";
import jasmineCore from "jasmine-core";

const target: Record<string, unknown> = {};
jasmineCore.installGlobals(target);

for (const name of ["describe", "it", "expect", "spyOn", "notApplicable"]) {
  assert.equal(typeof target[name], "function", `${name} should be installed`);
}
assert.equal(typeof (globalThis as any).describe, "undefined");
```

## State and version

`version()` returns the jasmine-core version. `reset()` removes specs, suites, and reporters and restores default configuration. Use `reset()` between independent runs in the same process because imports share the automatically-created core instance.

```ts pmcp-example
import assert from "node:assert/strict";
import jasmineCore from "jasmine-core";

assert.equal(typeof jasmineCore.version(), "string");
assert.match(jasmineCore.version(), /^7\./);
assert.equal(typeof jasmineCore.reset, "function");

jasmineCore.reset();
```

## Defining specs and expectations

After installing globals into a destination, use the installed functions from that destination rather than assuming Node globals exist. A spec has the form `describe(description, specDefinitions)`, with `it(description, testFunction, timeout)` for examples and `expect(actual)` for expectations.

```ts pmcp-example
import assert from "node:assert/strict";
import jasmineCore from "jasmine-core";

const j: Record<string, any> = {};
jasmineCore.installGlobals(j);

assert.doesNotThrow(() => {
  j.describe("a suite", () => {
    j.it("passes", () => {
      j.expect(true).toBe(true);
    });
  });
});
```

Defining a suite is not the same as executing it. Use the separate Jasmine runner/tooling when you need discovery, loading, configuration, reporters, and terminal execution.

## Spies

The documented spy helpers are:

- `spyOn(obj, methodName)`, returning a `Spy`.
- `spyOnAllFunctions(obj, includeNonEnumerable)`, returning the spied object.
- `spyOnProperty(obj, propertyName, accessType)`, returning a `Spy`.

They are intended for use in Jasmine specs or another correctly initialized Jasmine environment.

```ts pmcp-example
import assert from "node:assert/strict";
import jasmineCore from "jasmine-core";

const j: Record<string, any> = {};
jasmineCore.installGlobals(j);

assert.equal(typeof j.spyOn, "function");
assert.equal(typeof j.spyOnAllFunctions, "function");
assert.equal(typeof j.spyOnProperty, "function");

const object = { greet() { return "hello"; } };
assert.doesNotThrow(() => {
  j.describe("spies", () => {
    j.it("can define a method spy", () => {
      const spy = j.spyOn(object, "greet");
      assert.equal(typeof spy, "object");
    });
  });
});
```

## Pending versus not applicable

Jasmine 7 adds `notApplicable(reason)`. It marks a spec as not applicable, which is distinct from `pending`. Reporters must handle the `notApplicable` status; results can include `notApplicableReason`.

```ts pmcp-example
import assert from "node:assert/strict";
import jasmineCore from "jasmine-core";

const j: Record<string, any> = {};
jasmineCore.installGlobals(j);
assert.equal(typeof j.notApplicable, "function");
assert.equal(typeof j.pending, "function");

assert.doesNotThrow(() => {
  j.describe("environment-specific behavior", () => {
    j.it("is not applicable here", () => {
      j.notApplicable("This environment does not provide the required feature");
    });
  });
});
```

## 6.x shapes that are wrong in 7.x

Do not carry these older boot patterns forward:

```js
// 6.x — not a 7.x Node API
const jasmineCore = require('jasmine-core');
jasmineCore.boot();
```

Use:

```js
const jasmineCore = require('jasmine-core');
jasmineCore.installGlobals();
```

Likewise, `noGlobals()` was removed. In 7.x, simply importing the module is the no-automatic-globals behavior; call `installGlobals()` only when globals are wanted. To discard state, use `installGlobals()` as needed and then `reset()`; do not use the old `boot(false)` shape.

The 7.0 module redesign also removed most private APIs, stopped exposing `jasmineRequire`, and blocks monkey-patching. Do not depend on removed `HtmlReporter`, `HtmlSpecFilter`, or `jsApiReporter` surfaces.

## Configuration and integration migration notes

The documented 7.x migration uses a runner's `configureDefaultReporter` API rather than the old configuration shape:

```js
const runner = new Jasmine();
runner.configureDefaultReporter({
  color: false,
  alwaysListPendingSpecs: false
});
```

`jsLoader: "require"` is no longer supported; remove it or provide a custom loader. These runner configuration APIs are not APIs of the `jasmine-core` module itself.

## Does not cover

This skill does not cover the separate `jasmine` CLI/runner, browser runner boot files, test discovery or file loading, reporter implementation, complete matcher/async-matcher behavior, the full environment API, custom loaders, or migration details not documented in the supplied research. It also does not cover Zone.js or Karma integration; the supplied 7.0 notes state that Zone.js cannot be used with 7.x and current `karma-jasmine` is incompatible.
