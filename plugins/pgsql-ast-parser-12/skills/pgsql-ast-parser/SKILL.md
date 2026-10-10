---
name: pgsql-ast-parser
description: Use pgsql-ast-parser 12.x to parse PostgreSQL SQL into a typed AST, inspect or transform it, and generate SQL. Covers the standalone JavaScript/TypeScript API in resolved version 12.0.2.
---

Verified against pgsql-ast-parser@12.0.2 on 2026-09-08. 5 of 5 examples executed.

# pgsql-ast-parser

## Scope

This skill targets `pgsql-ast-parser` `^12.0.0` (resolved research version `12.0.2`). It is a PostgreSQL AST parser usable from Node or the browser. It does not support PL/pgSQL and may not cover unusual PostgreSQL syntax.

The package is an ordinary library: examples run directly with Bun and do not need a test runner, framework globals, a database, a network, or a filesystem.

## Parse statements

Import `parse` for potentially multiple statements and `parseFirst` when exactly one statement is expected. `parse` returns `Statement[]`; `parseFirst` returns a `Statement`.

```ts pmcp-example
import assert from 'node:assert/strict';
import { parse, parseFirst } from 'pgsql-ast-parser';

const statements = parse(`BEGIN TRANSACTION;
  INSERT INTO my_table VALUES (1, 'two');`);
assert.equal(statements.length, 2);

const statement = parseFirst('SELECT * FROM "my_table";');
assert.ok(statement);
assert.equal(statement.type, 'select');
```

Do not assume that examples from older major versions describe the current AST shape. In particular, historical release notes describe an old `ALTER TABLE` shape where `change` became `changes`, and an older `INSERT` shape with `values` or `select` that was later replaced by a single `insert` property. Those notes are not a v12 migration guide; the available v12 research exposes no v11-to-v12 breaking-change list. Inspect the parsed v12 AST or use the current types rather than copying an old shape.

## Generate SQL

Use `toSql.statement(ast)` for a complete statement. `toSql` also exposes generators for AST subparts.

```ts pmcp-example
import assert from 'node:assert/strict';
import { parseFirst, toSql } from 'pgsql-ast-parser';

const ast = parseFirst('SELECT * FROM users WHERE id = 1');
const sql = toSql.statement(ast);

assert.equal(typeof sql, 'string');
assert.match(sql.toLowerCase(), /select/);
assert.match(sql.toLowerCase(), /users/);
```

## Visit an AST

Create a visitor with `astVisitor`. Visitor callbacks can inspect nodes. If a callback wants traversal to continue through a node, call the corresponding method on `map.super()`.

```ts pmcp-example
import assert from 'node:assert/strict';
import { astVisitor, parseFirst } from 'pgsql-ast-parser';

const tables = new Set<string>();
let joins = 0;

const visitor = astVisitor(map => ({
  tableRef: (table: { name: string }) => {
    tables.add(table.name);
  },
  join: (join: unknown) => {
    joins++;
    map.super().join(join as never);
  }
}));

visitor.statement(parseFirst('SELECT * FROM ta LEFT JOIN tb ON ta.id = tb.id'));

assert.deepEqual([...tables].sort(), ['ta', 'tb']);
assert.equal(joins, 1);
```

## Transform an AST

Create a mapper with `astMapper`. Return a replacement node from a callback. Delegate unchanged nodes to `map.super()`. A mapper callback may return `null` to remove a node; consequently, a mapped statement can be `null`.

```ts pmcp-example
import assert from 'node:assert/strict';
import { astMapper, parseFirst, toSql } from 'pgsql-ast-parser';

const mapper = astMapper(map => ({
  tableRef: (table: { name: string }) => {
    if (table.name === 'foo') return { ...table, name: 'bar' };
    return map.super().tableRef(table as never);
  }
}));

const modified = mapper.statement(parseFirst('SELECT * FROM foo'));
assert.ok(modified);
assert.match(toSql.statement(modified).toLowerCase(), /bar/);
assert.doesNotMatch(toSql.statement(modified).toLowerCase(), /from foo/);
```

## Locations and comments

The documented API includes `parseWithComments()`, `locationOf(node)`, and location tracking through `parse(sql, { locationTracking: true })`. Use location tracking when source positions are needed; do not expect locations from an ordinary parse.

```ts pmcp-example
import assert from 'node:assert/strict';
import { locationOf, parse } from 'pgsql-ast-parser';

const statements = parse('SELECT 1', { locationTracking: true });
assert.equal(statements.length, 1);
const location = locationOf(statements[0]);
assert.ok(location);
```

`parseWithComments()` is the separate documented entry point when comments must be retained or associated with parsing. The available research does not specify its exact return shape, so inspect the package’s exported types before depending on comment-node fields.

## Literal and utility helpers

The package also documents `parseArrayLiteral()`, `parseGeometricLiteral()`, `parseIntervalLiteral()`, `assignChanged()`, and `arrayNilMap()`. They are library helpers and can be imported directly; their detailed signatures and return shapes are not covered by the available research, so consult the installed v12 TypeScript declarations before using them.

## Deno

The research documents a generated Deno module import:

```ts
import { /* imports */ } from 'https://deno.land/x/pgsql_ast_parser/mod.ts';
```

For Node, browser, and Bun usage, import from the npm package name as shown above. Repository build scripts, webpack configuration, test commands, and Deno-generation scripts are development machinery, not consumer requirements.

## Does not cover

- PL/pgSQL parsing.
- A complete PostgreSQL-syntax compatibility matrix or unusual/funky syntax.
- A v11-to-v12 migration guide; none was documented in the researched release material.
- Exact AST schemas for every statement and expression.
- Exact signatures or return shapes for `parseWithComments()`, `parseArrayLiteral()`, `parseGeometricLiteral()`, `parseIntervalLiteral()`, `assignChanged()`, and `arrayNilMap()`.
- Database execution, SQL validation, formatting guarantees, or a package-owned CLI/runner.
