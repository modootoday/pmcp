---
name: lowdb
description: Use lowdb v7's pure-ESM database API, distinguishing the v7 preset/update syntax from older v6 examples and choosing the correct Node or browser entry point.
---

Verified against lowdb@7.0.1 on 2026-09-08. 2 of 2 examples executed.

# lowdb v7

## Version and module shape

`lowdb` 7 is pure ESM and requires Node 18 or newer. Import the core API from `lowdb`:

```ts
import { Low, LowSync, Memory, MemorySync } from 'lowdb'
```

Import filesystem adapters and presets from `lowdb/node`:

```ts
import {
  DataFile,
  DataFileSync,
  JSONFile,
  JSONFileSync,
  TextFile,
  TextFileSync,
  JSONFilePreset,
  JSONFileSyncPreset,
} from 'lowdb/node'
```

Import browser storage adapters from `lowdb/browser`:

```ts
import {
  LocalStorage,
  SessionStorage,
  LocalStoragePreset,
  SessionStoragePreset,
} from 'lowdb/browser'
```

Do not use CommonJS imports or expect Node file adapters to be exported from the package root.

## v7 lifecycle

`Low` takes an adapter and default data. Its operations are asynchronous:

- `await db.read()` reads the adapter data.
- `await db.write()` writes the current data.
- `await db.update(fn)` invokes `fn(data)` and then writes the result.

`LowSync` provides synchronous `read()`, `write()`, and `update(fn)` equivalents. An adapter and default data are required; constructing a core database does not replace the explicit lifecycle calls.

For ordinary mutations, prefer `update`:

```ts
await db.update(({ posts }) => posts.push('hello'))
```

The callback receives the database data directly. Do not use the older pattern of mutating `db.data` and then separately calling `write()` when porting v6 code unless that explicit lifecycle is intentional.

### Async in-memory example

`Memory` can be used with `Low` when a plain script needs a database without a filesystem.

```ts pmcp-example
import assert from 'node:assert/strict'
import { Low, Memory } from 'lowdb'

const db = new Low(new Memory(), { posts: [] as string[] })

await db.read()
await db.update(({ posts }) => posts.push('hello'))

assert.deepEqual(db.data, { posts: ['hello'] })
```

### Synchronous in-memory example

Use `MemorySync` with `LowSync` for synchronous code.

```ts pmcp-example
import assert from 'node:assert/strict'
import { LowSync, MemorySync } from 'lowdb'

const db = new LowSync(new MemorySync(), { count: 0 })

db.read()
db.update((data) => {
  data.count += 1
})

assert.deepEqual(db.data, { count: 1 })
```

## Node JSON presets

The v7 preset names are `JSONFilePreset` and `JSONFileSyncPreset`:

```ts
import { JSONFilePreset } from 'lowdb/node'

const db = await JSONFilePreset('db.json', { posts: [] })
await db.update(({ posts }) => posts.push('hello world'))
```

`JSONFilePreset(filename, defaultData)` returns a promise for `Low<Data>`. `JSONFileSyncPreset(filename, defaultData)` returns `LowSync<Data>`.

The underlying adapters are available when explicit lifecycle control is needed:

```ts
import { Low } from 'lowdb'
import { JSONFile } from 'lowdb/node'

const db = new Low(new JSONFile('file.json'), {})
await db.read()
await db.write()
```

These adapters use the filesystem, so they are not demonstrated in the standalone examples here: the required example environment has no filesystem access. A normal Node application can use them directly.

## Custom serialization

`DataFile` and `DataFileSync` accept a filename plus an object containing `parse` and `stringify` functions. Use them with `Low` or `LowSync` when the stored format is not JSON:

```ts
import { Low } from 'lowdb'
import { DataFile } from 'lowdb/node'

const adapter = new DataFile('db.yaml', {
  parse: YAML.parse,
  stringify: YAML.stringify,
})
const db = new Low(adapter, { posts: [] })
```

The serialization library supplying `YAML.parse` and `YAML.stringify` is not part of lowdb. The file adapter therefore requires an application environment with that serializer and filesystem access.

## Browser adapters

Browser storage adapters are imported from `lowdb/browser`, not `lowdb/node`:

```ts
import { LocalStorage, SessionStorage } from 'lowdb/browser'
```

The browser adapters require a browser `window` storage environment and are not runnable in the standalone Node example environment. The browser preset names are `LocalStoragePreset` and `SessionStoragePreset`.

## v6-to-v7 mistakes

- Replace `JSONPreset` with `JSONFilePreset`.
- Replace `JSONSyncPreset`-style assumptions with the v7 name `JSONFileSyncPreset`.
- Replace `db.data.posts.push(...)` followed by `await db.write()` with `await db.update(({ posts }) => posts.push(...))` when using the v7 update style.
- Do not copy v6's `NODE_ENV=test` behavior as a v7 contract. The v6 release notes describe automatic `Memory` adapter selection for that case; v7's documented API requires selecting an adapter explicitly.
- Do not import filesystem adapters from `lowdb`; use `lowdb/node`.
- Do not import browser storage adapters from `lowdb`; use `lowdb/browser`.
- Do not assume a CommonJS or Node 16 runtime. v7 is pure ESM and dropped Node 16 support.

## Not covered

This skill does not cover filesystem execution details, browser `window` storage setup, YAML or other external serializers, CLI usage, server/framework integration, or test-runner-specific setup. Those require an environment beyond a standalone `bun example.ts` script or are not specified by the supplied research.
