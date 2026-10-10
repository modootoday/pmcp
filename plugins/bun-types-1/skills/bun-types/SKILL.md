---
name: bun-types
description: Use bun-types ^1.0.0 as Bun runtime declarations, with correct v1 installation, module names, and the boundary between type availability and runtime availability.
---

Verified against bun-types@1.4.2 on 2026-09-08. 2 of 2 examples executed.

# bun-types

`bun-types` is a declaration-only package for Bun's JavaScript runtime APIs. Installing it does not provide a runtime implementation; the program must be run by Bun.

## v1.0.0 installation and TypeScript configuration

For the v1.0.0 package, install the package directly:

```sh
bun add bun-types
```

Opt into its declarations in `tsconfig.json` or `jsconfig.json`:

```json
{
  "types": ["bun-types"]
}
```

The declarations aggregate Bun globals, `bun` APIs, Node-compatible declarations, `bun:sqlite`, `bun:test`, and `bun:ffi` declarations. The `bun` module is documented as an alias of `globalThis.Bun`.

Do not confuse this v1.0.0 setup with the newer documented installation surface. The current README recommends `@types/bun` instead:

```sh
bun add -D @types/bun
```

Current `@types/bun` is a shim that loads `bun-types`, and ordinary `@types/*` discovery can make the declarations available without the old explicit `types` entry. That is a later package/documentation shape; when targeting `bun-types` v1.0.0, use the direct package and explicit configuration shown above.

## Runtime boundary

`bun-types` only affects type checking. It does not make Bun APIs available in Node or another JavaScript runtime. Run code using these declarations with Bun.

The examples below are standalone Bun scripts. They import the declaration package by name and use only APIs that can run without a network or filesystem dependency.

## The `bun` module

Import runtime APIs from `bun`, not from `bun-types`:

```ts pmcp-example
import type {} from "bun-types";
import { file, serve, write, which, dns } from "bun";
import assert from "node:assert/strict";

assert.equal(typeof file, "function");
assert.equal(typeof serve, "function");
assert.equal(typeof write, "function");
assert.equal(typeof which, "function");
assert.equal(typeof dns, "object");
```

The declared surfaces include:

- `file(path)`, which creates a Bun file object.
- `serve({ fetch, port })`, which starts a server and therefore belongs in a Bun program with an appropriate lifecycle.
- `write(destination, input)`, which asynchronously writes a supported string, blob, typed array, array buffer, or blob-part array.
- `which(command, options?)`, which returns a path or `null`; its options can provide `PATH` and `cwd`.
- `dns.lookup(hostname, options?)`, whose options include address family, socket type, flags, port, and backend.

For example, the declaration for `which` is shaped like this:

```ts
const executable: string | null = which("some-command", {
  PATH: "/some/path",
  cwd: "/some/working/directory",
});
```

Do not assume that installing `bun-types` makes `file`, `serve`, `write`, `which`, or `dns` callable in a plain Node process.

## SQLite

SQLite is a separate Bun built-in module, imported as `bun:sqlite`:

```ts pmcp-example
import type {} from "bun-types";
import { Database } from "bun:sqlite";
import assert from "node:assert/strict";

const db = new Database(":memory:");
db.run("CREATE TABLE foo (bar TEXT)");
db.run("INSERT INTO foo VALUES (?)", "baz");

assert.deepEqual(db.query("SELECT * FROM foo").all(), [{ bar: "baz" }]);
```

`Database` accepts an optional filename and options. The options form includes `readonly`, `create`, and `readwrite`. An in-memory database can be selected with `":memory:"`.

The declaration exposes these important operations:

- `run(sqlQuery, ...bindings)`, returning `void`.
- `query(sqlQuery)`, returning a statement.
- `prepare(sqlQuery, params?)`, returning a statement.

Bindings are passed to `run` as SQL query bindings, as in the example. Do not import SQLite from the ordinary `sqlite` package; the declared entry point is `bun:sqlite`.

## Other declared entry points

The package also declares `bun:test` and `bun:ffi`. Their declarations are available through this package, but they are intended for Bun's own test and FFI usage rather than for the standalone examples in this skill. Do not expect `bun-types` itself to execute either feature.

## Common mistakes

- **Using the old setup with a current installation guide:** `bun-types` v1.0.0 uses a direct dependency and explicit `"types": ["bun-types"]`; current documentation instead presents `@types/bun`.
- **Importing declarations as runtime APIs:** import runtime functions from `bun` and SQLite from `bun:sqlite`. `bun-types` supplies declarations only.
- **Running the code under Node:** the declarations do not polyfill `globalThis.Bun`, `bun`, or `bun:*` modules.
- **Using `describe`, `it`, or `expect` in a direct script:** those are not supplied by a standalone script. The examples here use `node:assert/strict` and can be run directly with Bun.
- **Treating `bun:sqlite` as a normal npm module:** use the built-in module specifier exactly as declared.

## Not covered

This skill does not specify the detailed APIs or usage patterns inside `bun:test` or `bun:ffi`, because the supplied research only identifies those entry points and does not include their declarations. It also does not cover server lifecycle management, filesystem effects from `file` or `write`, DNS results, or the complete `Bun` global API. Those require the Bun runtime and details outside the provided research.
