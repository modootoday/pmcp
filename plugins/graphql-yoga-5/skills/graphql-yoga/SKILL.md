---
name: graphql-yoga
description: Use graphql-yoga 5 to serve a validated schema through a Fetch handler, create per-request context, mask unexpected resolver errors and test the HTTP/GraphQL boundary. Use for Yoga services and Pothos integration while preserving the project's adapter and server lifecycle.
---

# GraphQL Yoga 5

Historical validation of the earlier revision: Verified against graphql-yoga@5.22.0 on 2026-09-07. 3 of 3 examples executed. Those checks did not exercise readiness responses or masking output. Current fixture evidence is recorded separately.

Inspect the installed Yoga/GraphQL versions, schema builder, context type and runtime adapter first. Import `createYoga` from `graphql-yoga`, not legacy `@graphql-yoga/node`. Preserve existing plugins and server configuration.

## Handle a request

Build the schema with the project's builder or `createSchema`, require `validateSchema(schema)` to return no errors, then pass it to `createYoga`. Build request-specific context in the callback.

```ts
import assert from "node:assert/strict";
import { validateSchema } from "graphql";
import { createSchema, createYoga } from "graphql-yoga";

const schema = createSchema({
  typeDefs: "type Query { requestId: String! }",
  resolvers: {
    Query: {
      requestId: (
        _parent: unknown,
        _args: unknown,
        context: { requestId: string },
      ) => context.requestId,
    },
  },
});
assert.deepEqual(validateSchema(schema), []);
const yoga = createYoga({
  schema,
  context: ({ request }) => ({
    requestId: request.headers.get("x-request-id") ?? "anonymous",
  }),
  maskedErrors: { isDev: false },
});
const response = await yoga.fetch("http://fixture/graphql", {
  method: "POST",
  headers: { "Content-Type": "application/json", "x-request-id": "first" },
  body: JSON.stringify({ query: "{ requestId }" }),
});
assert.equal(response.status, 200);
assert.deepEqual(await response.json(), { data: { requestId: "first" } });
```

`yoga.fetch` invokes the handler in process; it does not start a server or send an external request. For Node serving, adapt through `node:http` `createServer(yoga)` and manage listen, errors and close through that server. Yoga does not own `.start()` or `.stop()`.

## Isolate context and errors

Pass a Pothos schema directly. If Pothos context caching is used, merge a fresh `initContextCache()` into each request context. Never reuse a mutable context across requests.

Keep unexpected-error masking enabled in production. Deliberately exposed domain errors need reviewed public messages; internal `Error` details must not leak. HTTP status alone does not establish GraphQL success: inspect `errors` and partial/null `data`.

Test requests with distinct context values, invalid variables and an unexpected resolver error. Assert internal error text is absent from the response. Test status decisions through the configured adapter rather than assuming a universal status rule.

Configure plugins on the existing server. A readiness configuration check is not an endpoint test. In v5, plugins added through `onPluginInit`/`addPlugin` follow the adding plugin; confirm installed plugin documentation before changing order.

The interoperability fixture targets Yoga 5.22.0, GraphQL 16.13.1 and Pothos 4.13.1. It tests in-process requests and masking, not browser GraphiQL, readiness plugins, subscriptions, deployed HTTP lifecycle or authentication policy.

## Primary sources

- [Context](https://the-guild.dev/graphql/yoga-server/docs/features/context)
- [Error masking](https://the-guild.dev/graphql/yoga-server/docs/features/error-masking)
- [Migration from v4](https://the-guild.dev/graphql/yoga-server/docs/migration/migration-from-yoga-v4)
