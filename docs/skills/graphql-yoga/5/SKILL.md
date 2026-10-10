---
name: graphql-yoga
description: Use graphql-yoga ^5.0.0 to build a Fetch-compatible GraphQL handler, execute it directly in scripts, and configure documented readiness and error-handling plugins. Avoid legacy Yoga v2/v4 server shapes.
---

Verified against graphql-yoga@5.22.0 on 2026-09-07. 3 of 3 examples executed.

# graphql-yoga ^5.0.0

## Current API shape

Import from `graphql-yoga`, not `@graphql-yoga/node`.

Build an executable `GraphQLSchema` with `createSchema({ typeDefs, resolvers })`, then pass that schema to `createYoga({ schema })`. The returned Yoga instance is a Fetch-compatible handler and exposes `.fetch()`.

```ts pmcp-example
import assert from 'node:assert/strict'
import { createSchema, createYoga } from 'graphql-yoga'

const schema = createSchema({
  typeDefs: /* GraphQL */ `
    type Query {
      hello: String
    }
  `,
  resolvers: {
    Query: {
      hello: () => 'world'
    }
  }
})

const yoga = createYoga({ schema })

const response = await yoga.fetch('http://yoga/graphql', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: '{ hello }' })
})

assert.equal(response.status, 200)
assert.deepEqual(await response.json(), {
  data: { hello: 'world' }
})
```

`yoga.fetch()` simulates an HTTP request for in-process execution or testing. It does not send a real network request.

## Running Yoga with Node HTTP

`createYoga()` does not own the Node server lifecycle. Adapt it with Node's `node:http` server and call `listen()` yourself:

```ts
import { createServer } from 'node:http'
import { createYoga } from 'graphql-yoga'

const yoga = createYoga({ schema })
const server = createServer(yoga)
server.listen(4000)
```

A plain script can exercise the handler with `.fetch()`, but a real endpoint requires Node's HTTP server or another runtime/framework adapter. GraphiQL is provided by the running HTTP endpoint, not by schema construction alone.

Yoga no longer owns `.start()` or `.stop()`, and it does not configure the Node HTTP server.

## Readiness checks

Configure the readiness plugin with `useReadinessCheck({ endpoint, check })`. The check may be asynchronous:

```ts pmcp-example
import assert from 'node:assert/strict'
import { createSchema, createYoga, useReadinessCheck } from 'graphql-yoga'

const schema = createSchema({
  typeDefs: 'type Query { hello: String }',
  resolvers: { Query: { hello: () => 'world' } }
})

let checked = false
const yoga = createYoga({
  schema,
  plugins: [
    useReadinessCheck({
      endpoint: '/ready',
      check: async () => {
        checked = true
      }
    })
  ]
})

assert.equal(typeof yoga.fetch, 'function')
assert.equal(checked, false)
```

The documented research establishes the configuration and callback shape, but not the exact readiness response body or status behavior. Do not infer those details from this skill.

## Error coordinates and masking

Enable error-coordinate handling with `useErrorCoordinate()`. Configure masking through `maskedErrors.maskError`; the package exports the `maskError` utility:

```ts pmcp-example
import assert from 'node:assert/strict'
import {
  createSchema,
  createYoga,
  maskError,
  useErrorCoordinate
} from 'graphql-yoga'

const schema = createSchema({
  typeDefs: 'type Query { hello: String }',
  resolvers: { Query: { hello: () => 'world' } }
})

const yoga = createYoga({
  schema,
  plugins: [useErrorCoordinate()],
  maskedErrors: {
    maskError: (error, message, isDev) =>
      maskError(error, message, isDev)
  }
})

assert.equal(typeof yoga.fetch, 'function')
```

The available research establishes these imports and call shapes, but does not specify masking output or coordinate metadata. Do not add behavior-dependent assertions without checking the package documentation.

## v5 migration traps

- Node.js 16 support was dropped in v5.
- Use the single `graphql-yoga` package. Older examples using `@graphql-yoga/node` are not the current import shape.
- Use `createYoga`, not the older Yoga `createServer` API.
- Pass a ready `GraphQLSchema` to `createYoga`; use `createSchema({ typeDefs, resolvers })` as the documented bridge when starting from SDL and resolver maps.
- Yoga no longer owns `.start()` or `.stop()`, and it does not configure the Node HTTP server. Use `node:http` or the adapter for the runtime you deploy on.
- Do not copy the old pattern of calling `server.start()`.
- When a plugin adds another plugin through `onPluginInit` / `addPlugin`, v5 inserts the dependency immediately after the adding plugin. In v4, added plugins were appended to the end. Ordering-sensitive code must account for this change:

```ts
const plugin: Plugin = {
  onPluginInit({ addPlugin }) {
    addPlugin(useAnotherPlugin())
  }
}
```

## What this skill does not cover

The research does not specify the exact readiness response, error-masking output, error-coordinate format, plugin type imports, deployment adapters, GraphiQL customization, or detailed server lifecycle management. It also does not cover schema features beyond the documented `createSchema` bridge and `.fetch()` execution example. The actual HTTP server lifecycle and browser GraphiQL experience must be exercised through the runtime tool or adapter rather than a standalone script.

Sources:
- https://the-guild.dev/graphql/yoga-server/docs?utm_source=openai
- https://the-guild.dev/graphql/yoga-server/docs/migration/migration-from-yoga-v4?utm_source=openai
- https://the-guild.dev/graphql/yoga-server/tutorial/basic/03-graphql-server?utm_source=openai
