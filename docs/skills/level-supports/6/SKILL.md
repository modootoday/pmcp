---
name: level-supports
description: Use level-supports ^6.0.0 to construct abstract-level capability manifests, merge manifests, and test optional database features safely.
---

Verified against level-supports@6.2.0 on 2026-09-08. 6 of 6 examples executed.

# level-supports

## Scope

`level-supports` creates capability manifests for `abstract-level` databases. Version 6 is not compatible with `levelup` or `abstract-leveldown`. Node.js 16 or newer is required.

The package is ordinary module code, not a test runner or CLI. Import its named `supports` export and attach the resulting manifest to a database object yourself.

## Import the v6 API

```ts pmcp-example
import assert from 'node:assert/strict'
import { supports } from 'level-supports'

const manifest = supports()
assert.equal(manifest.seek, false)
assert.equal(manifest.permanence, false)
assert.deepEqual(manifest.encodings, {})
assert.deepEqual(manifest.events, {})
assert.deepEqual(manifest.additionalMethods, {})
assert.deepEqual(manifest.signals, {})
```

A common migration mistake is retaining the old v2 default-import shape:

```js
// v2 / older code — do not use with v6
const supports = require('level-supports')
```

Use the v6 named export instead:

```js
const { supports } = require('level-supports')
```

## Build a manifest

Pass a partial manifest to `supports()` and assign the result to the database's `supports` property:

```ts pmcp-example
import assert from 'node:assert/strict'
import { supports } from 'level-supports'

const db = { supports: supports({
  permanence: false,
  seek: true,
  encodings: {
    utf8: true,
    json: true
  },
  events: {
    put: true
  },
  additionalMethods: {
    compact: true
  },
  signals: {
    iterators: true
  }
}) }

assert.equal(db.supports.permanence, false)
assert.equal(db.supports.seek, true)
assert.equal(db.supports.encodings.utf8, true)
assert.equal(db.supports.encodings.json, true)
assert.equal(db.supports.events.put, true)
assert.equal(db.supports.additionalMethods.compact, true)
assert.equal(db.supports.signals.iterators, true)
```

The top-level capability fields documented for v6 are `snapshots`, `permanence`, `seek`, `createIfMissing`, `errorIfExists`, `deferredOpen`, and `streams`. Nested capability groups are `encodings`, `events`, `additionalMethods`, and `signals`. Snapshot-related manifests also expose `implicitSnapshots` and `explicitSnapshots`; `snapshots` is the backwards-compatible snapshot alias.

## Merge manifests

`supports()` accepts zero or more partial manifests. Later top-level properties overwrite earlier ones. Nested capability objects are also replaced as properties of the merged manifest; they are not recursively combined.

```ts pmcp-example
import assert from 'node:assert/strict'
import { supports } from 'level-supports'

const merged = supports(
  {
    seek: true,
    encodings: { utf8: true },
    events: { put: true }
  },
  {
    seek: false,
    encodings: { json: true }
  }
)

assert.equal(merged.seek, false)
assert.deepEqual(merged.encodings, { json: true })
assert.deepEqual(merged.events, { put: true })
```

If you need both encoding declarations, include both in the same input object rather than expecting nested objects from earlier manifests to be merged.

## Test capabilities by truthiness

Feature values are not coerced to the boolean `true`. Falsy or absent top-level properties become `false`, while truthy values are retained. Test support with truthiness, not `=== true`.

```ts pmcp-example
import assert from 'node:assert/strict'
import { supports } from 'level-supports'

const manifest = supports(
  { seek: true, permanence: 1 },
  { seek: { mode: 'fast' } }
)

assert.deepEqual(manifest.seek, { mode: 'fast' })
assert.equal(manifest.permanence, 1)
assert.equal(Boolean(manifest.seek), true)
assert.notEqual(manifest.seek, true)

const unsupported = supports({ seek: false })
assert.equal(unsupported.seek, false)
assert.equal(Boolean(unsupported.seek), false)
```

The same rule applies to snapshot-related capability values and other top-level feature properties. Do not assume every supported value is literally `true`.

## Snapshot capabilities

Use the snapshot fields when describing database snapshot support. The manifest surface includes `implicitSnapshots`, the backwards-compatible `snapshots` alias, and `explicitSnapshots`.

```ts pmcp-example
import assert from 'node:assert/strict'
import { supports } from 'level-supports'

const manifest = supports({
  implicitSnapshots: true,
  snapshots: true,
  explicitSnapshots: false
})

assert.equal(manifest.implicitSnapshots, true)
assert.equal(manifest.snapshots, true)
assert.equal(manifest.explicitSnapshots, false)
assert.equal(Boolean(manifest.implicitSnapshots), true)
```

## Signals and iterators

In v6, `signals.iterators` describes signal support for `db.iterator()`, `db.keys()`, and `db.values()`. The manifest only declares the capability; it does not create an iterator or an `AbortController` integration.

```ts pmcp-example
import assert from 'node:assert/strict'
import { supports } from 'level-supports'

const manifest = supports({
  signals: { iterators: true }
})

assert.equal(manifest.signals.iterators, true)
if (manifest.signals.iterators) {
  const controller = new AbortController()
  assert.ok(controller.signal)
}
```

## v6 versus older manifests

Do not copy the v2 manifest shape into v6 code. Older documentation described fields such as `bufferKeys`, `openCallback`, `promises`, `status`, and `clear`, and described `encodings` as a boolean. In v6, `encodings` is an object of encoding capabilities and cannot be `false`; the v6 surface instead documents the fields and nested groups listed above.

## Does not cover

This skill does not cover opening or operating an `abstract-level` database, implementing any declared capability, iterator behavior, abort behavior, or integration with a particular database package. It also does not cover the old `levelup` or `abstract-leveldown` APIs, package installation, or CLI/test-runner usage.
