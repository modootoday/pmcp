---
name: graphql
description: Use graphql 16 to validate schemas, execute operations with variables and request context, and distinguish document validation from resolver execution. Use for GraphQL.js services and Yoga/Pothos interoperability without adopting GraphQL 17 APIs.
---

# GraphQL.js 16

Inspect the installed version, schema construction, server adapter and test commands first. Preserve the project's package manager, module mode and validation policy. This line targets `graphql@16.13.1`; it does not establish compatibility with GraphQL 17.

## Validate and execute

Call `validateSchema(schema)` before exposing a newly constructed schema. Checking only that a query type exists misses invalid names and other schema errors.

`graphql({ schema, source, variableValues, contextValue })` parses, validates and executes. Await its result so asynchronous resolvers are supported. `graphqlSync` is suitable only when execution is synchronous.

```ts
import assert from "node:assert/strict";
import { buildSchema, graphql, validateSchema } from "graphql";

const schema = buildSchema("type Query { greeting(name: String!): String! }");
assert.deepEqual(validateSchema(schema), []);
const result = await graphql({
  schema,
  source: "query Greeting($name: String!) { greeting(name: $name) }",
  variableValues: { name: "Ada" },
  rootValue: { greeting: ({ name }: { name: string }) => `Hello ${name}` },
});
assert.equal(result.errors, undefined);
assert.equal(result.data?.greeting, "Hello Ada");
```

For pre-parsed documents, use `parse(source)`, then `validate(schema, document)`, and call `execute` only after the validation errors are empty. `execute` does not replace document validation. A cached document's validation depends on the schema and validation rules as well as the document.

Pass request identity and dependencies through `contextValue`; do not store request state in global resolver objects.

## Test the failure boundary

- A numeric value for a `String!` variable must produce an error before operation execution. Verify `errors` and absent `data` for variable coercion failure.
- An unknown field must fail document validation. Do not call `execute` on that invalid document.
- Resolver failures can return partial `data` with `errors`. Non-null propagation can make a parent field or all data null; inspect both fields.
- GraphQL.js does not choose HTTP status or mask sensitive resolver details. Test those through the actual server adapter.

Execution result objects may have a null prototype. Assert relevant fields or normalize through an actual JSON serialization boundary rather than assuming deep equality with an ordinary object literal.

## Integrate without another schema

Pothos `builder.toSchema()` produces a standard `GraphQLSchema`. Validate it, then pass that same schema to GraphQL.js or Yoga `createYoga({ schema })`. Inspect peer dependency ranges before changing the GraphQL major.

The companion fixture targets schema validation, invalid variables/documents, typed Pothos resolvers, execution, request context and Yoga masking. Its HTTP requests are in process; it does not test a listener, deployment or WebSocket. Record successful execution separately from the selected version target.

## Primary sources

- [GraphQL.js 16 API](https://www.graphql-js.org/api-v16/graphql/)
- [Execution API](https://www.graphql-js.org/api-v16/execution/)
- [Pothos schema builder](https://pothos-graphql.dev/docs/guide/schema-builder)
- [Yoga context](https://the-guild.dev/graphql/yoga-server/docs/features/context)
