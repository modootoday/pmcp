---
name: pothos-core
description: Use @pothos/core ^4.0.0 to build executable GraphQL schemas, account for v4 nullability and ID defaults, use context caching, and write/register typed plugins.
---

Verified against @pothos/core@4.13.1 on 2026-09-07. 7 of 7 examples executed.

# @pothos/core v4

Use this skill for `@pothos/core` `^4.0.0`. The package builds standard `graphql.js` schemas; serving the schema requires an external GraphQL server such as Yoga.

## Requirements

v4 requires TypeScript 4.7.0 or newer, GraphQL 16.6.0 or newer, and Node 18.0 or newer.

## Build a schema

The default export is `SchemaBuilder`. Define the query type, then call `toSchema()`:

```ts pmcp-example
import assert from 'node:assert/strict';
import SchemaBuilder from '@pothos/core';

const builder = new SchemaBuilder({});

builder.queryType({
  fields: (t) => ({
    hello: t.string({
      args: {
        name: t.arg.string(),
      },
      resolve: (_parent, { name }) => `hello, ${name || 'World'}`,
    }),
  }),
});

const schema = builder.toSchema();
const query = schema.getQueryType();
assert.ok(query);
assert.ok(query.getFields().hello);
assert.equal(query.getFields().hello.type.toString(), 'String');
assert.equal(query.getFields().hello.args[0]?.name, 'name');
```

Fields are nullable by default in v4. Do not assume the v3 default of non-null fields. Set `nullable: false` on an individual field when required, or configure the builder globally.

```ts pmcp-example
import assert from 'node:assert/strict';
import SchemaBuilder from '@pothos/core';

const builder = new SchemaBuilder({});
builder.queryType({
  fields: (t) => ({
    required: t.string({ nullable: false, resolve: () => 'ok' }),
    optional: t.string({ resolve: () => null }),
  }),
});

const fields = builder.toSchema().getQueryType()!.getFields();
assert.equal(fields.required.type.toString(), 'String!');
assert.equal(fields.optional.type.toString(), 'String');
```

## Restore v3 defaults when migrating

A common migration error is copying v3 code that expects non-null-by-default fields or v3 configuration names. For one-shot compatibility, use the `Defaults: 'v3'` type parameter and `defaults: 'v3'` option:

```ts pmcp-example
import assert from 'node:assert/strict';
import SchemaBuilder from '@pothos/core';

const builder = new SchemaBuilder<{
  Defaults: 'v3';
}>({ defaults: 'v3' });

builder.queryType({
  fields: (t) => ({
    value: t.string({ resolve: () => 'v3-style' }),
  }),
});

const field = builder.toSchema().getQueryType()!.getFields().value;
assert.equal(field.type.toString(), 'String!');
```

The more explicit alternative is to configure only nullability:

```ts
const builder = new SchemaBuilder<{
  DefaultFieldNullability: false;
}>({
  defaultFieldNullability: false,
});
```

## ID scalar changes

In v4, `ID` input is `string`; `ID` output is `number | string | bigint`. Code written for the v3 ID input shape (`number | string`) can fail type checking. Restore the v3 scalar shape explicitly if that is required by the application:

```ts pmcp-example
import assert from 'node:assert/strict';
import SchemaBuilder from '@pothos/core';

const builder = new SchemaBuilder<{
  Scalars: { ID: { Input: number | string; Output: number | string } };
}>({});

builder.queryType({
  fields: (t) => ({
    id: t.id({ resolve: () => 42 }),
  }),
});

const field = builder.toSchema().getQueryType()!.getFields().id;
assert.equal(field.type.toString(), 'ID');
```

## Context cache

`initContextCache` is a named export intended for creating the cache portion of a request context. Merge its result into the context object supplied to the GraphQL server, alongside application-specific values:

```ts pmcp-example
import assert from 'node:assert/strict';
import { initContextCache } from '@pothos/core';

const context = {
  ...initContextCache(),
  currentUser: { id: 'user-1' },
};

assert.equal(context.currentUser.id, 'user-1');
assert.ok(context);
```

The cache is request context data; initialize it per request rather than sharing one context object across requests.

## ObjectRef and shared object fields

`ObjectRef` is a named export. In v4, refs carry the `Types extends SchemaTypes` type parameter. Use an object ref when common fields should be attached to multiple refs:

```ts pmcp-example
import assert from 'node:assert/strict';
import SchemaBuilder, { ObjectRef } from '@pothos/core';

const builder = new SchemaBuilder({});
const userRef = builder.objectRef<{ id: string }>('User');

function addCommonFields(refs: ObjectRef<unknown, { id: string }>[]) {
  for (const ref of refs) {
    builder.objectFields(ref, (t) => ({
      id: t.exposeID('id', {}),
      idLength: t.int({
        resolve: (parent) => parent.id.length,
      }),
    }));
  }
}

builder.objectType(userRef, {
  fields: (t) => ({
    name: t.string({ resolve: () => 'Ada' }),
  }),
});
addCommonFields([userRef]);
builder.queryType({
  fields: (t) => ({
    user: t.field({
      type: userRef,
      resolve: () => ({ id: 'abc' }),
    }),
  }),
});

const fields = builder.toSchema().getType('User') as any;
assert.ok(fields.getFields().id);
assert.ok(fields.getFields().idLength);
```

Do not use the older constructor shape that passes `typename` to builder constructors; v4 changed builder constructors and ref/type authoring APIs. `FieldRef` constructors also take builder/field options, and input field refs are separated from argument refs.

## Plugins

Plugin authors can import `BasePlugin`, `SchemaTypes`, and `SchemaBuilder` as named exports. A plugin is registered by name and class:

```ts pmcp-example
import assert from 'node:assert/strict';
import SchemaBuilder, { BasePlugin, SchemaTypes } from '@pothos/core';

const pluginName = 'example';

class PothosExamplePlugin<Types extends SchemaTypes> extends BasePlugin<Types> {}

SchemaBuilder.registerPlugin(pluginName, PothosExamplePlugin);

const builder = new SchemaBuilder({ plugins: [pluginName] });
builder.queryType({
  fields: (t) => ({
    ok: t.boolean({ resolve: () => true }),
  }),
});

assert.ok(builder.toSchema().getQueryType()!.getFields().ok);
```

Plugin behavior depends on registration/import side effects and Pothos's schema-build lifecycle; it is not an independent helper API. Plugins are instantiated each time `toSchema()` is called, and `beforeBuild` is the last opportunity for a plugin to add types or fields. If a plugin is split into a global registration module, import that module before building the schema.

## What this skill does not cover

- Running or serving a schema with Yoga or another GraphQL server.
- Plugin hooks beyond the registration and lifecycle facts documented here.
- GraphQL execution, HTTP context construction, authentication, or request handling.
- Pothos plugins other than the core plugin authoring surface shown above.
- The complete `SchemaBuilder`, field, argument, scalar, input, interface, union, or subscription API beyond the documented examples.
