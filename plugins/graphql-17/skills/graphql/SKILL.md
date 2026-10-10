---
name: graphql
description: "Practical guidance for graphql ^17.0.0: parse, print, visit, build schemas, and execute operations from standalone scripts."
---

Verified against graphql@17.0.2 on 2026-09-07. 6 of 6 examples executed.

# graphql ^17.0.0

Use `graphql` as a library for parsing documents, transforming ASTs, constructing schemas, and executing operations. Version 17 publishes conditional CommonJS/ES-module exports and the npm package is in the 17.x line.

## Parse and print documents

`parse(source)` returns a `DocumentNode`. `print(ast)` formats an AST back to GraphQL source. Importing these APIs from the package root is supported.

```ts pmcp-example
import assert from 'node:assert/strict';
import { parse, print } from 'graphql';

const ast = parse('{ hero { name } }');
assert.equal(
  print(ast),
  '{\n  hero {\n    name\n  }\n}',
);
```

A source may also be supplied as a `Source`, and parse options can be supplied as the second argument. The research does not specify individual parse-option fields, so do not infer them here.

## Visit and transform an AST

`visit(root, visitor)` traverses an AST. A visitor can return a replacement node. Use `Kind.NAME` when creating a replacement name node rather than relying on an older or undocumented node shape.

```ts pmcp-example
import assert from 'node:assert/strict';
import { Kind, parse, print, visit } from 'graphql/language';

const document = parse('{ hero { name } }');
const edited = visit(document, {
  Field: (node) => {
    if (node.name.value === 'hero') {
      return {
        ...node,
        name: { kind: Kind.NAME, value: 'human' },
      };
    }
  },
});

assert.equal(
  print(edited),
  '{\n  human {\n    name\n  }\n}',
);
```

`visit` also accepts an optional visitor-key map, but the supplied research does not document custom key-map usage.

## Build a schema from SDL

`buildSchema(source)` creates a `GraphQLSchema` from schema definition language. It is available from `graphql` and `graphql/utilities`.

```ts pmcp-example
import assert from 'node:assert/strict';
import { buildSchema } from 'graphql/utilities';

const schema = buildSchema('type Query { hello: String }');
assert.equal(schema.getQueryType()?.name, 'Query');
```

## Execute an operation asynchronously

Call `graphql` with a `GraphQLArgs` object containing at least `schema` and `source`. The arguments can include `rootValue`, `variableValues`, and `operationName`. Resolver functions may return values, promises, or arrays of promises.

```ts pmcp-example
import assert from 'node:assert/strict';
import { buildSchema, graphql } from 'graphql';

const schema = buildSchema(`
  type Query {
    greeting(name: String!): String
  }
`);

const result = await graphql({
  schema,
  source: 'query SayHello($name: String!) { greeting(name: $name) }',
  rootValue: {
    greeting: ({ name }: { name: string }) => `Hello, ${name}!`,
  },
  variableValues: { name: 'Ada' },
  operationName: 'SayHello',
});

assert.deepEqual(result, { data: { greeting: 'Hello, Ada!' } });
```

In v17, `GraphQLArgs` inherits parse, validate, and execute options. The research does not enumerate those options; use only options documented by the API version you have installed.

## Execute synchronously

`graphqlSync(args)` is the synchronous counterpart. Use it when the operation and resolvers are synchronous.

```ts pmcp-example
import assert from 'node:assert/strict';
import { buildSchema, graphqlSync } from 'graphql';

const schema = buildSchema('type Query { hello: String }');
const result = graphqlSync({
  schema,
  source: '{ hello }',
  rootValue: { hello: 'world' },
});

assert.deepEqual(result, { data: { hello: 'world' } });
```

## Construct a schema with GraphQL types

The older, commonly copied shape of constructing a `GraphQLSchema` directly is still a documented API shape. It uses `GraphQLObjectType` and `GraphQLString`, then executes through `graphql`.

```ts pmcp-example
import assert from 'node:assert/strict';
import {
  GraphQLObjectType,
  GraphQLSchema,
  GraphQLString,
  graphql,
} from 'graphql';

const schema = new GraphQLSchema({
  query: new GraphQLObjectType({
    name: 'RootQueryType',
    fields: {
      hello: {
        type: GraphQLString,
        resolve() {
          return 'world';
        },
      },
    },
  }),
});

const result = await graphql({ schema, source: '{ hello }' });
assert.deepEqual(result, { data: { hello: 'world' } });
```

## v17-specific cautions

- Do not assume older `instanceof`-based predicates: v17 uses brand checks instead.
- Conditional exports are enabled. Browser use requires a bundler/runtime that understands the package exports; the research specifically identifies webpack and rollup as expected bundlers.
- v17 adds schema coordinates, BigInt support, executable descriptions, a legacy incremental executor, and a `graphql` harness abstraction with async parse/validate support. These surfaces are not demonstrated here because the supplied research does not provide their APIs or standalone examples.
- Later v17 beta changes treat `undefined` as absent for variables and ignore unknown input-object fields whose value is `undefined`.
- Incremental-delivery integrations changed shape during v17 development. Do not copy alpha protocol types or imports blindly. The cited Apollo integration required users on `graphql@17.0.0-alpha.2` to upgrade to `alpha.9`; legacy protocol support required `@yaacovcr/transform`.
- `createSourceEventStream` was demoted to a helper taking `ValidatedExecutionArgs`, and `executeQueryOrMutationOrSubscriptionEvent` was renamed to `executeRootSelectionSet` in later v17 beta changes.
- Node 20 support was dropped and Node 26 support was added according to the cited release notes.

## Not covered

This skill does not specify the full type-system API, validation rules, subscription or incremental-execution APIs, schema-coordinate APIs, BigInt behavior, harness APIs, every parse/execute option, browser bundler configuration, or the exact final incremental response protocol. Consult the v17 API documentation or release notes for those surfaces before using them.
