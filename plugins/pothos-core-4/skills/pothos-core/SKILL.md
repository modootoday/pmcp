---
name: pothos-core
description: Use @pothos/core 4 to build typed schemas with explicit nullability, arguments and request context, validate the full schema and integrate it with GraphQL.js or Yoga. Use for Pothos field changes without replacing existing plugins or project configuration.
---

# Pothos Core 4

Historical validation of the earlier revision: Verified against @pothos/core@4.13.1 on 2026-09-07. 7 of 7 examples executed. That revision checked shapes and imports, not full consumer type checking or server execution. Current fixture evidence is recorded separately.

Inspect the installed versions, builder generics, plugins and context first. Reuse the existing builder. Pothos builds the schema; GraphQL.js executes operations and a server such as Yoga handles HTTP.

## Add a typed field

Import default `SchemaBuilder` and specify context in its type map. Required arguments and non-null output are independent choices; write both when required by the contract.

```ts
import assert from "node:assert/strict";
import SchemaBuilder from "@pothos/core";
import { graphql, validateSchema } from "graphql";

type Context = { requestId: string };
const builder = new SchemaBuilder<{ Context: Context }>({});
builder.queryType({
  fields: (t) => ({
    greeting: t.string({
      nullable: false,
      args: { name: t.arg.string({ required: true }) },
      resolve: (_parent, { name }, context) =>
        `${context.requestId}: Hello ${name}`,
    }),
  }),
});
const schema = builder.toSchema();
assert.deepEqual(validateSchema(schema), []);
const result = await graphql({
  schema,
  source: "query Greeting($name: String!) { greeting(name: $name) }",
  variableValues: { name: "Ada" },
  contextValue: { requestId: "first" },
});
assert.equal(result.errors, undefined);
assert.equal(result.data?.greeting, "first: Hello Ada");
```

A numeric `t.string` resolver must fail TypeScript checking. Do not hide it with `any` or casts. Incoming JSON still needs runtime GraphQL validation.

## Preserve schema defaults

- v4 fields are nullable by default. Use `nullable: false` for required outputs and inspect project defaults before changing them globally.
- A deliberate v3 migration can use the `Defaults: "v3"` type map with `defaults: "v3"`; do not change defaults incidentally while adding a field.
- v4 `ID` input is a string; output supports string, number or bigint. Review scalar overrides explicitly.
- Build shared shapes with `builder.objectRef<Shape>("Name")`. Generic helpers need the declared schema types; `unknown` does not satisfy `SchemaTypes`.

Require `validateSchema(builder.toSchema())` to return no errors before serving. Shape assertions alone miss reserved names and other GraphQL invariants.

## Serve with request context

Pass the schema to `createYoga({ schema, context })`. Create `initContextCache()` inside each context factory when caching is used, then merge request identity/dependencies. A shared cache can share request-specific data.

Plugin registration is a side effect; import registration before configuring its name. Follow installed plugin type augmentation requirements. Use `import type` for types such as `SchemaTypes` with `verbatimModuleSyntax`.

The fixture targets Pothos 4.13.1, GraphQL 16.13.1 and Yoga 5.22.0. It compiles a typed consumer and deliberately invalid resolver, validates the schema, executes operations and checks request isolation. It does not validate every scalar, plugin, subscription or adapter.

## Primary sources

- [Schema builder](https://pothos-graphql.dev/docs/guide/schema-builder)
- [Context](https://pothos-graphql.dev/docs/guide/context)
- [Upstream](https://github.com/hayes/pothos)
