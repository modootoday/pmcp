---
name: tedious
description: Use tedious ^20.0.0 from a plain Node.js script to connect to SQL Server, execute requests, manage transactions, and perform bulk loads. Covers the documented v20 API surface, its one-request-per-connection constraint, and the Node.js 22 requirement.
---

Verified against tedious@20.0.0 on 2026-09-08. 3 of 3 examples executed.

# tedious `^20.0.0`

## Runtime and package boundary

- Version 20 requires **Node.js >=22**. Node.js 18, 20, and 21 are not supported.
- Install with `npm install tedious`.
- This is a Node.js library implementing the TDS protocol for Microsoft SQL Server. It does not provide a CLI or test runner.
- The package exports `Connection`, `Request`, `TYPES`, `ISOLATION_LEVEL`, and `connect`.
- Tedious does **not** provide connection pooling. Use `tedious-connection-pool` when pooling is required.
- The package's normal runtime entry points are its generated `lib/tedious.js` and `lib/tedious.d.ts` files.

## Imports

Use the package exports directly:

```js
const { Connection, Request, TYPES, ISOLATION_LEVEL, connect } = require('tedious');
```

The older individual-property style is also valid:

```js
const Connection = require('tedious').Connection;
const Request = require('tedious').Request;
const TYPES = require('tedious').TYPES;
```

Do not assume that a test runner supplies `describe`, `it`, or `expect`; Tedious is a library, not a runner.

## Constructing and opening a connection

A connection is constructed with a configuration object containing the server, options, and authentication settings. Calling `connect` starts the connection attempt:

```js
const { Connection } = require('tedious');

const config = {
  server: '192.168.1.210',
  options: {},
  authentication: {
    type: 'default',
    options: { userName: 'test', password: 'test' }
  }
};

const connection = new Connection(config);
connection.on('connect', (err) => {
  if (err) console.error('Error:', err);
});
connection.connect();
```

`connect(callback)` is also available. The connection-related examples in this skill only construct objects or exercise local request setup; actually calling `connect` or executing SQL requires a reachable SQL Server and credentials.

## Requests

Create a request with SQL text and a completion callback. Add input parameters with `addParameter`; output parameters use `addOutputParameter`. A request can also be paused, resumed, timed out, or cancelled.

```ts pmcp-example
import assert from 'node:assert/strict';
import { Request, TYPES } from 'tedious';

const request = new Request('select @city', (err, rowCount) => {
  assert.equal(err, null);
  assert.equal(rowCount, 1);
});

request.addParameter('city', TYPES.VarChar, 'London');
assert.equal(typeof request.pause, 'function');
assert.equal(typeof request.resume, 'function');
assert.equal(typeof request.setTimeout, 'function');
assert.equal(typeof request.cancel, 'function');
```

Attach a `row` listener to receive result columns when the request is executed:

```js
const request = new Request("select 42, 'hello world'", function (err, rowCount) {
  if (err) console.error(err);
});

request.on('row', function (columns) {
  columns.forEach(function (column) {
    console.log(column.value);
  });
});

connection.execSql(request);
```

The connection methods for request execution are `execSql(request)`, `execSqlBatch(request)`, `callProcedure(request)`, and `execute(request, parameters)`. `prepare(request)` and `unprepare(request)` are also available.

**Important sequencing rule:** only one request may be active on a connection at a time. Do not start another request until the previous request's completion callback has run.

## Data types

Use members of `TYPES` when adding request or bulk-load columns. The documented type set includes:

`TinyInt`, `Bit`, `SmallInt`, `Int`, `SmallDateTime`, `Real`, `Money`, `DateTime`, `Float`, `Decimal`, `Numeric`, `SmallMoney`, `BigInt`, `Image`, `Text`, `UniqueIdentifier`, `NText`, `VarBinary`, `VarChar`, `Binary`, `Char`, `NVarChar`, `NChar`, `Xml`, `Time`, `Date`, `DateTime2`, `DateTimeOffset`, `UDT`, `TVP`, and `Variant`.

```ts pmcp-example
import assert from 'node:assert/strict';
import { TYPES } from 'tedious';

assert.equal(typeof TYPES.Int, 'object');
assert.equal(typeof TYPES.VarChar, 'object');
assert.equal(typeof TYPES.NVarChar, 'object');
assert.equal(typeof TYPES.DateTime2, 'object');
assert.equal(typeof TYPES.TVP, 'object');
```

## Transactions

`Connection` provides `beginTransaction(callback, [name], [isolationLevel])`, `commitTransaction(callback)`, `rollbackTransaction(callback, [name])`, and `transaction(callback)`. `ISOLATION_LEVEL` is exported for transaction isolation settings.

Do not begin a transaction or execute SQL until the connection is established, and continue to obey the one-active-request rule.

## Bulk loads

Create a bulk-load operation with `newBulkLoad(tableName, options, callback)`, define columns with `addColumn`, and submit rows with `execBulkLoad(bulkLoad, rows)`.

```ts pmcp-example
import assert from 'node:assert/strict';
import { Connection, TYPES } from 'tedious';

const connection = new Connection({
  server: 'localhost',
  options: {},
  authentication: {
    type: 'default',
    options: { userName: 'user', password: 'password' }
  }
});

const bulkLoad = connection.newBulkLoad('MyTable', { keepNulls: true }, (error, rowCount) => {});
bulkLoad.addColumn('myInt', TYPES.Int, { nullable: false });
bulkLoad.addColumn('myString', TYPES.NVarChar, { length: 50, nullable: true });

assert.equal(typeof bulkLoad.getTableCreationSql(), 'string');
assert.equal(typeof bulkLoad.setTimeout, 'function');
assert.equal(typeof bulkLoad.cancel, 'function');
```

When a live connection is available, submit rows like this:

```js
connection.execBulkLoad(bulkLoad, [
  { myInt: 7, myString: 'hello' },
  { myInt: 23, myString: 'world' }
]);
```

The bulk-load completion callback receives an error and row count. Bulk loads can also be timed out or cancelled.

## Common mistakes

- Running v20 on Node.js 18, 20, or 21. Upgrade to Node.js 22 or newer.
- Copying an older example that assumes Tedious supplies pooling. It does not.
- Starting a second request before the first request's completion callback runs.
- Treating `Request` as a promise or assuming SQL execution happens during construction. Construct it, then pass it to a connection method.
- Forgetting to add parameters with the appropriate `TYPES` member.
- Calling connection or bulk-load execution APIs in a standalone example without a reachable SQL Server. These operations require a real server and credentials.
- Treating repository commands such as build, docs, or tests as runtime requirements. They are development scripts, not a package-owned CLI.

## Not covered

This skill does not specify SQL Server connection options beyond the documented example, authentication variants, the behavior of individual SQL data types, stored-procedure parameter details, error-event inventories, pooling APIs, or deployment/network configuration. It also does not provide a live database integration test; those behaviors require SQL Server, valid credentials, and a configured environment.
