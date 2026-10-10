---
name: sinon
description: Use Sinon ^22.0.0 for standalone spies, stubs, fake timers, sandboxes, and Sinon assertions.
---

Verified against sinon@22.1.0 on 2026-09-08. 8 of 8 examples executed.

# Sinon ^22.0.0

## Import and version-specific shape

Sinon 22 supports both CommonJS and ESM through the package root. ESM consumers can use:

```ts pmcp-example
import sinon from "sinon";
import assert from "node:assert/strict";

assert.equal(typeof sinon.spy, "function");
assert.equal(typeof sinon.stub, "function");
```

The older, commonly copied CommonJS form remains valid because the package provides a CommonJS `require` condition:

```js
const sinon = require("sinon");
```

Do not infer from Sinon’s ESM source migration that `require("sinon")` stopped working. The ESM migration occurred in 21.1.0; Sinon 22 retains the CommonJS package entry.

Sinon is a library, not a test runner. A plain script has no injected `describe`, `it`, or `expect`; use Node’s assertions or `sinon.assert` directly.

## Spies

Use `sinon.spy()` for a callable that records calls, `sinon.spy(fn)` to wrap a function, or `sinon.spy(object, "method")` to wrap an existing method. A property can also be spied on with the documented third `types` argument.

Useful recorded data includes `callCount`, `called`, `calledOnce`, `args`, `firstCall`, `lastCall`, `returnValues`, and `thisValues`. Useful checks and accessors include `calledWith`, `calledWithExactly`, `calledBefore`, `calledAfter`, `getCall`, `getCalls`, `returned`, `threw`, and `withArgs`.

When a spy replaces an object method, restore it when finished. `resetHistory()` clears call history but does not restore the original method; `restore()` restores the wrapped method.

```ts pmcp-example
import sinon from "sinon";
import assert from "node:assert/strict";

const object = {
  greet(name: string) {
    return `Hello, ${name}`;
  }
};

const spy = sinon.spy(object, "greet");
assert.equal(object.greet("Ada"), "Hello, Ada");
assert.equal(spy.callCount, 1);
assert.equal(spy.calledOnce, true);
assert.deepEqual(spy.firstCall.args, ["Ada"]);
assert.equal(spy.calledWithExactly("Ada"), true);
assert.equal(spy.returned("Hello, Ada"), true);

spy.resetHistory();
assert.equal(spy.callCount, 0);
spy.restore();
assert.equal(object.greet("Grace"), "Hello, Grace");
```

## Stubs

Use `sinon.stub()` for a standalone stub or `sinon.stub(object, "method")` to replace an object method. Configure behavior with `returns`, `throws`, `resolves`, `rejects`, `callsFake`, `callsThrough`, `returnsThis`, `value`, `get`, `onCall`, and argument-specific `withArgs` behavior. `yield`, `yields`, and `yieldsAsync` configure callback behavior.

Per-call configuration is ordered: `onCall(0)` applies to the first call, `onCall(1)` to the second, and so on. A default such as `returns(...)` handles calls not otherwise configured. Restore replaced methods after use.

`wrappedMethod` is the wrapped original method on a stub created from an object method. `callsThrough()` delegates to that original implementation, while `callsFake()` replaces behavior.

```ts pmcp-example
import sinon from "sinon";
import assert from "node:assert/strict";

const stub = sinon.stub();
stub.onCall(0).returns("Apple pie");
stub.onCall(1).returns("Blueberry pie");
stub.returns("Raspberry pie");

assert.equal(stub(), "Apple pie");
assert.equal(stub(), "Blueberry pie");
assert.equal(stub(), "Raspberry pie");
assert.equal(stub.callCount, 3);

const asyncStub = sinon.stub();
asyncStub.resolves("done");
assert.equal(await asyncStub(), "done");

const object = {
  value() {
    return 7;
  }
};
const methodStub = sinon.stub(object, "value").throws(new Error("blocked"));
assert.throws(() => object.value(), /blocked/);
methodStub.restore();
assert.equal(object.value(), 7);
```

## Fake timers

Use `sinon.useFakeTimers()` to replace timer behavior with a controllable clock. Schedule work, advance with `tick`, and call `restore()` when finished. The clock also documents `countTimers`, `jump`, `next`, `nextAsync`, `now`, `reset`, `runAll`, `runMicrotasks`, `runToFrame`, `runToLast`, `setSystemTime`, and `tick`.

`next()` advances to and fires the first scheduled timer. `nextAsync()` additionally allows scheduled promise callbacks to run, so use it when testing timer callbacks that enqueue asynchronous work.

```ts pmcp-example
import sinon from "sinon";
import assert from "node:assert/strict";

const clock = sinon.useFakeTimers();
let calls = 0;
setTimeout(() => {
  calls += 1;
}, 500);

assert.equal(clock.countTimers(), 1);
clock.tick(499);
assert.equal(calls, 0);
clock.tick(1);
assert.equal(calls, 1);
clock.restore();
```

```ts pmcp-example
import sinon from "sinon";
import assert from "node:assert/strict";

const clock = sinon.useFakeTimers();
const events: string[] = [];
setTimeout(() => {
  events.push("timer");
  Promise.resolve().then(() => events.push("promise"));
}, 10);

await clock.nextAsync();
assert.deepEqual(events, ["timer", "promise"]);
clock.restore();
```

## Sandboxes

`sinon.createSandbox()` creates an isolated alternative to the default sandbox on the `sinon` object. Keep the sandbox and call `sandbox.restore()` during cleanup so spies, stubs, and other replacements do not leak into later work.

A sandbox can also inject selected APIs into an object. `injectInto` selects the target object and `properties` selects the APIs to inject.

```ts pmcp-example
import sinon from "sinon";
import assert from "node:assert/strict";

const object = {
  greet() {
    return "original";
  }
};
const sandbox = sinon.createSandbox();
const spy = sandbox.spy(object, "greet");

assert.equal(object.greet(), "original");
assert.equal(spy.calledOnce, true);
sandbox.restore();
assert.equal(object.greet(), "original");
```

```ts pmcp-example
import sinon from "sinon";
import assert from "node:assert/strict";

const facade: { spy?: typeof sinon.spy } = {};
const sandbox = sinon.createSandbox({
  injectInto: facade,
  properties: ["spy"]
});
const object = { run() {} };
const spy = facade.spy!(object, "run");
object.run();
assert.equal(spy.calledOnce, true);
sandbox.restore();
```

## Assertions and matchers

Sinon assertions are available under `sinon.assert`. Documented callable members include `fail(message)`, `match(actual, expectation)`, and `expose(target, options)`. Spy assertions include `calledOnce` and `calledWith`.

`sinon.assert.match(actual, expectation)` performs the assertion directly. It is not a matcher object whose `.test()` method should be called.

```ts pmcp-example
import sinon from "sinon";
import assert from "node:assert/strict";

const spy = sinon.spy();
spy("message");
sinon.assert.calledOnce(spy);
sinon.assert.calledWith(spy, "message");

sinon.assert.match({ role: "admin", active: true }, { role: "admin" });
assert.throws(
  () => sinon.assert.match({ role: "user" }, { role: "admin" }),
  /expected value to match/
);
```

`sinon.assert.expose(target, { prefix: "" })` exposes Sinon assertion methods on the supplied assertion object without a name prefix. Use this only when deliberately extending another assertion API; otherwise call `sinon.assert` directly. The exposed assertion API is primarily useful when integrating with a test or assertion tool; such integration is exercised by that tool rather than by a bare script.

## Cleanup and compatibility

Restore every replaced method and every fake clock. Prefer a sandbox when a task creates several doubles, since one `sandbox.restore()` cleans up the sandbox-managed replacements.

Sinon 22 targets modern runtimes moving toward ES2023 and requires no transpiler or polyfills in supporting runtimes. Older runtimes may require a transpiler supplied by the dependent project; the compatibility research suggests Sinon 9 for older browsers.

Sinon’s source repository relies on generated artifacts for normal package and test workflows. This skill assumes the published package is installed; it does not describe rebuilding Sinon from its repository.

## Not covered

This skill does not cover Sinon’s complete API, every spy/stub method overload, browser bundler configuration, repository build commands, test-runner integration, older Sinon major versions, or runtime-specific transpiler/polyfill setup beyond the compatibility boundary described above.
