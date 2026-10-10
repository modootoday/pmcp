---
name: dexie
description: Use Dexie 4.x for typed IndexedDB databases, table access, and reactive queries. Covers the Dexie/EntityTable TypeScript shapes, schema setup, liveQuery, and the boundary between standalone Dexie and dexie-cloud.
---

Verified against dexie@4.4.5 on 2026-09-08. 3 of 3 examples executed.

# Dexie 4

## Use this when

Use `dexie` as the main class for defining an IndexedDB database, its schema, and typed tables. Dexie is usable from a normal module or script; it is not itself a test runner or framework.

## Core database setup

`Dexie` is both the default export and a named export. Define stores with a version before opening the database:

```ts
import { Dexie } from "dexie";

const db = new Dexie("MyDatabase");
db.version(1).stores({
  friends: "++id, name, age",
});

await db.open();
```

The schema string uses the primary key first, followed by indexed fields. `++id` declares an auto-generated primary key. Ordinary table operations are asynchronous:

```ts
await db.table("friends").add({ name: "Ada", age: 36 });
const friends = await db.table("friends").toArray();
```

Do not assume that declaring a store opens the database. Call `open()` or perform an operation that opens it, and handle the resulting promise.

`db.table(storeName)` returns a table dynamically. If the table is declared as a property on a typed database, use that property instead; the dynamic form is useful when the store name is only available at runtime.

## TypeScript table shapes

Dexie 4 adds `EntityTable<T, KeyPropName>`. It derives the key type from the entity and makes an auto-generated key optional when inserting plain objects:

```ts
import { Dexie, type EntityTable } from "dexie";

interface Friend {
  id: number;
  name: string;
  age: number;
}

const db = new Dexie("FriendsDatabase") as Dexie & {
  friends: EntityTable<Friend, "id">;
};

db.version(1).stores({
  friends: "++id, name, age",
});

await db.friends.add({ name: "Ada", age: 36 });
```

The older, commonly seen `Table<T, TKey>` shape is still valid in Dexie 4. Do not rewrite working code merely because it uses `Table`; `EntityTable` is the newer convenience for entity-oriented TypeScript:

```ts
import { Dexie, type Table } from "dexie";

interface Friend {
  id: number;
  name: string;
  age: number;
}

const db = new Dexie("FriendsDatabase") as Dexie & {
  friends: Table<Friend, number>;
};

db.version(1).stores({
  friends: "++id, name, age",
});
```

A class-oriented database can declare an `EntityTable` and map records to a class:

```ts
import { Dexie, type EntityTable } from "dexie";

class Friend {
  id!: number;
  constructor(public name: string, public age: number) {}
}

class AppDB extends Dexie {
  friends!: EntityTable<Friend, "id">;

  constructor() {
    super("FriendsDB");
    this.version(1).stores({ friends: "++id, name, age" });
    this.friends.mapToClass(Friend);
  }
}
```

The `EntityTable` type omits class methods for inserts, so plain objects can be passed. `mapToClass()` is the separate choice when reads should be mapped to instances.

## Reactive queries with `liveQuery`

`liveQuery` is a named export. It accepts a synchronous or asynchronous querier and returns an Observable. Subscribe with `next` and `error`; retain the subscription and unsubscribe when the consumer is disposed:

```ts
import { liveQuery } from "dexie";

const observable = liveQuery(() =>
  db.friends.where("age").between(50, 75).toArray()
);

const subscription = observable.subscribe({
  next: (friends) => console.log(friends),
  error: (error) => console.error(error),
});

subscription.unsubscribe();
```

The querier should perform the Dexie query whose changes should be observed. `liveQuery` is not a replacement for `subscribe`; creating the Observable alone does not establish a consumer subscription.

## Cloud boundary

Cloud support is not part of standalone `dexie`. Install and configure `dexie-cloud-addon`, pass the addon when constructing the database, then call `db.cloud.configure(...)`. Do not expect `db.cloud` to exist on a database created only from `dexie`.

Cloud administration is a CLI concern: use `npx dexie-cloud ...`. It requires Node.js and uses `dexie-cloud.json` and `dexie-cloud.key`; it is not something to exercise through the standalone Dexie API.

## Runnable checks

These examples only exercise construction and schema declaration, so they do not require an IndexedDB implementation, a browser, a network, or a filesystem. Database reads and writes require the runtime's IndexedDB support.

### Named and default exports, versioned stores, and `table()`

```ts pmcp-example
import assert from "node:assert/strict";
import DexieDefault, { Dexie } from "dexie";

assert.equal(DexieDefault, Dexie);

const db = new Dexie("DexieSkillCore");
db.version(1).stores({
  friends: "++id, name, age",
  pets: "++id, name, kind",
});

const friends = db.table("friends");
assert.equal(friends.name, "friends");
assert.deepEqual(
  db.tables.map((table) => table.name).sort(),
  ["friends", "pets"],
);
```

### `liveQuery` is a named export

```ts pmcp-example
import assert from "node:assert/strict";
import { liveQuery } from "dexie";

assert.equal(typeof liveQuery, "function");
const observable = liveQuery(() => 42);
assert.equal(typeof observable.subscribe, "function");
```

### TypeScript entity declaration shape

```ts pmcp-example
import assert from "node:assert/strict";
import { Dexie, type EntityTable } from "dexie";

interface Friend {
  id: number;
  name: string;
}

const db = new Dexie("DexieSkillEntities") as Dexie & {
  friends: EntityTable<Friend, "id">;
};

db.version(1).stores({ friends: "++id, name" });
assert.equal(db.table("friends").name, "friends");
```

## What this skill does not cover

It does not cover IndexedDB support or runtime-specific setup, detailed query/filtering APIs beyond the documented `liveQuery` example, transactions and error classes, database migrations, addon installation/configuration details, or the `dexie-cloud` CLI command set. Those areas require the package/runtime or sources beyond the research provided here.
