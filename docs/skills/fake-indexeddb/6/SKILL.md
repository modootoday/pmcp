---
name: fake-indexeddb
description: Use fake-indexeddb ^6.0.0 as a pure-JavaScript, in-memory IndexedDB implementation in Node.js scripts and test environments.
---

Verified against fake-indexeddb@6.2.5 on 2026-09-08. 3 of 3 examples executed.

# fake-indexeddb ^6.0.0

## What this package provides

`fake-indexeddb` is a pure-JavaScript, in-memory implementation of IndexedDB. Data is not persisted to disk. Version 6 requires Node.js `>=18` and a native or polyfilled `structuredClone`.

The package is useful when code expects browser IndexedDB but is running under Node.js. It can either install its implementation on the global object or provide IndexedDB objects for explicit use.

## Global setup

Import `fake-indexeddb/auto` before code that uses the global IndexedDB names. This installs the fake `indexedDB` implementation and related globals.

```ts pmcp-example
import "fake-indexeddb/auto";
import assert from "node:assert/strict";

const request = indexedDB.open("global-example", 1);

await new Promise<void>((resolve, reject) => {
  request.onupgradeneeded = () => {
    const db = request.result;
    const store = db.createObjectStore("books", { keyPath: "isbn" });
    store.createIndex("by_title", "title", { unique: true });
    store.put({ isbn: 123456, title: "Quarry Memories", author: "Fred" });
  };

  request.onsuccess = () => {
    const db = request.result;
    const read = db.transaction("books").objectStore("books").get(123456);
    read.onsuccess = () => {
      assert.deepEqual(read.result, {
        isbn: 123456,
        title: "Quarry Memories",
        author: "Fred",
      });
      db.close();
      resolve();
    };
    read.onerror = () => reject(read.error);
  };
  request.onerror = () => reject(request.error);
});
```

`auto` is the global-installing entry point. Import it before wrappers such as Dexie or other code that reads the global IndexedDB implementation.

## Explicit imports

For a plain script that does not want global setup, import the objects from the package root. The root exports `indexedDB`, `IDBFactory`, `IDBKeyRange`, `IDBCursor`, `IDBCursorWithValue`, `IDBDatabase`, `IDBIndex`, `IDBObjectStore`, `IDBOpenDBRequest`, `IDBRequest`, `IDBTransaction`, and `IDBVersionChangeEvent`. The default export is the fake factory as well.

```ts pmcp-example
import assert from "node:assert/strict";
import { indexedDB, IDBKeyRange } from "fake-indexeddb";

const request = indexedDB.open("explicit-example", 1);

await new Promise<void>((resolve, reject) => {
  request.onupgradeneeded = () => {
    request.result.createObjectStore("numbers");
  };

  request.onsuccess = () => {
    const db = request.result;
    const store = db.transaction("numbers", "readwrite").objectStore("numbers");
    store.put("low", 10);
    store.put("high", 20);

    const readTransaction = db.transaction("numbers");
    const cursorRequest = readTransaction
      .objectStore("numbers")
      .openCursor(IDBKeyRange.lowerBound(15));

    cursorRequest.onsuccess = () => {
      assert.equal(cursorRequest.result.key, 20);
      db.close();
      resolve();
    };
    cursorRequest.onerror = () => reject(cursorRequest.error);
  };
  request.onerror = () => reject(request.error);
});
```

Use `IDBKeyRange` from this package with the fake implementation. Do not assume the browser's global `IDBKeyRange` is present when using explicit imports.

## Resetting in-memory state

The database is in memory. To start with a fresh factory and no previous database state, construct a new `IDBFactory` and replace the global factory when using the `auto` surface.

```ts pmcp-example
import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { IDBFactory } from "fake-indexeddb";

const first = indexedDB.open("reset-example", 1);
await new Promise<void>((resolve, reject) => {
  first.onupgradeneeded = () => {
    first.result.createObjectStore("items");
  };
  first.onsuccess = () => {
    first.result.close();
    resolve();
  };
  first.onerror = () => reject(first.error);
});

globalThis.indexedDB = new IDBFactory();

const second = indexedDB.open("reset-example", 1);
await new Promise<void>((resolve, reject) => {
  second.onupgradeneeded = () => {
    assert.equal(second.result.objectStoreNames.contains("items"), false);
    second.result.close();
    resolve();
  };
  second.onerror = () => reject(second.error);
});
```

Resetting replaces the factory; it does not persist or reload data from disk.

## Common version-6 mistakes

- **Using only `import "fake-indexeddb/auto"` when explicit objects are needed:** `auto` installs globals. For dependency injection or a script that avoids globals, import `indexedDB` and the relevant classes from `fake-indexeddb`.
- **Using the old root CommonJS shape:** CommonJS is supported, but older examples may use a v4-era default shape. The documented current destructuring form is `const { indexedDB, IDBKeyRange } = require("fake-indexeddb")`; older code may instead need `require("fake-indexeddb").default`.
- **Expecting persistence:** this implementation is in memory only. Create a new `IDBFactory` when a fresh state is required.
- **Expecting the v5 `structuredClone` polyfill:** v5 removed that polyfill, and v6 requires native or polyfilled `structuredClone` in environments such as jsdom. A supported polyfill setup is `import "core-js/stable/structured-clone"` before `import "fake-indexeddb/auto"`.
- **Assuming old error behavior:** v6 uses `DOMException` rather than ordinary errors for IndexedDB errors.
- **Running under an unsupported Node version:** v6 declares Node.js `>=18`.
- **Putting runner globals in a standalone script:** `describe`, `it`, and `expect` are not provided by this package. Direct scripts should use IndexedDB's request and transaction events, as in the examples.

## Other entry points

The package publishes `fake-indexeddb/auto` and individual `fake-indexeddb/lib/*` modules, including modules for cursors, factories, key ranges, object stores, and transactions. Both `import` and `require` conditions are provided.

The package also exposes the package-specific `forceCloseDatabase` helper for forcibly closing a database. Its behavior and usage are not demonstrated by the supplied research, so use it only where the package's own API documentation or source has been consulted.

## Not covered

This skill does not cover the complete IndexedDB API semantics, every individual exported class or `lib/*` subpath, the detailed behavior of `forceCloseDatabase`, jsdom configuration beyond the `structuredClone` requirement, Jest configuration beyond loading `fake-indexeddb/auto`, or integration-specific setup for wrappers such as Dexie. It also does not cover persistence, since this package does not provide it.
