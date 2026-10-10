---
name: msw
description: Use MSW 2.x for HTTP and GraphQL request interception. Covers the v2 API, Node setup, response construction, resolver inputs, migration traps from MSW 1.x, and the browser entry point.
---

Verified against msw@2.15.0 on 2026-09-08. 3 of 3 examples executed.

# MSW 2.x

Use this skill for `msw` in the `^2.0.0` range. MSW 2 requires Node.js 18+ and TypeScript 4.7+. The primary v2 imports are `http`, `graphql`, and `HttpResponse` from `msw`; environment-specific setup is imported from `msw/node` or `msw/browser`.

## The v2 shape

HTTP handlers use the `http` namespace and receive one resolver-information object:

```ts
import { http, HttpResponse } from 'msw'

const handlers = [
  http.get('/user/:id', ({ params }) => {
    return HttpResponse.json({ id: params.id })
  }),
  http.post('/user', async ({ request }) => {
    const body = await request.json()
    return HttpResponse.json(body, { status: 201 })
  }),
]
```

A handler by itself does not intercept anything. Pass handlers to `setupServer(...handlers)` in Node or `setupWorker(...handlers)` in a browser.

`HttpResponse.json(value, options?)` creates a response. The options can include `status` and `statusText`. `HttpResponse.error()` creates a network-error response.

Resolver information can include `request`, `params`, and `cookies`:

- `request.url` is a string. Parse it with `new URL(request.url)` when URL components are needed.
- Read a request body with Fetch request methods such as `await request.json()`.
- Path parameters are available through `params`.
- Cookies are available through `cookies`.

## Node interception

Import `setupServer` from `msw/node`. Start interception with `server.listen()`, and finish with `server.close()`. `server.resetHandlers()` restores the initial handlers after runtime handler changes and is useful between tests.

The Node integration intercepts native HTTP/HTTPS traffic without stubbing `fetch` or Axios. The following is a complete standalone Node example; it uses an absolute URL so it can run directly without a framework or test runner:

```ts pmcp-example
import assert from 'node:assert/strict'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'

const server = setupServer(
  http.get('https://example.test/users/:id', ({ params, request }) => {
    const url = new URL(request.url)
    return HttpResponse.json(
      { id: params.id, host: url.host },
      { status: 202, statusText: 'Mocked' },
    )
  }),
)

server.listen()
try {
  const response = await fetch('https://example.test/users/abc-123')
  assert.equal(response.status, 202)
  assert.equal(response.statusText, 'Mocked')
  assert.deepEqual(await response.json(), {
    id: 'abc-123',
    host: 'example.test',
  })
} finally {
  server.close()
}
```

Request bodies are read from `request`, not from a v1 `req` argument:

```ts pmcp-example
import assert from 'node:assert/strict'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'

const server = setupServer(
  http.post('https://example.test/user', async ({ request }) => {
    const user = await request.json() as { firstName: string }
    return HttpResponse.json({ ...user, accepted: true }, { status: 201 })
  }),
)

server.listen()
try {
  const response = await fetch('https://example.test/user', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ firstName: 'John' }),
  })
  assert.equal(response.status, 201)
  assert.deepEqual(await response.json(), {
    firstName: 'John',
    accepted: true,
  })
} finally {
  server.close()
}
```

In a test runner, the documented lifecycle is `listen()` before tests, `resetHandlers()` after each test, and `close()` after all tests.

## GraphQL handlers

Import `graphql` and `HttpResponse` from `msw`. The documented methods include `graphql.query()`, `graphql.mutation()`, `graphql.link(url)`, and `graphql.operation()`. A query or mutation resolver receives values including `query` and `variables`.

GraphQL subscriptions are not supported. A standalone Node example can exercise a query handler through the normal Node setup:

```ts pmcp-example
import assert from 'node:assert/strict'
import { graphql, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'

const server = setupServer(
  graphql.query('GetUser', ({ variables }) => {
    return HttpResponse.json({
      data: { user: { name: variables.userId === '1' ? 'John' : 'Unknown' } },
    })
  }),
)

server.listen()
try {
  const response = await fetch('https://example.test/graphql', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      operationName: 'GetUser',
      query: 'query GetUser($userId: ID!) { user { name } }',
      variables: { userId: '1' },
    }),
  })
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), {
    data: { user: { name: 'John' } },
  })
} finally {
  server.close()
}
```

A mutation follows the same pattern, using `graphql.mutation('CreateUser', resolver)` and reading its input from `variables`.

## Browser setup

Browser interception uses the separate `msw/browser` entry point:

```ts
import { setupWorker } from 'msw/browser'

const worker = setupWorker(/* http/graphql handlers */)
await worker.start()
```

This requires a Service Worker and is therefore not a standalone `bun example.ts` environment. Do not import `setupWorker` from `msw`; that is the MSW 1.x shape.

## Migration traps from MSW 1.x

Do not carry these older forms into v2:

- `rest.get(...)` becomes `http.get(...)`.
- `import { setupWorker } from 'msw'` becomes `import { setupWorker } from 'msw/browser'`.
- `(req, res, ctx) => ...` becomes a resolver such as `({ request, params, cookies }) => ...`.
- `res(ctx.json(value))` becomes `HttpResponse.json(value)`.
- `req.url` is now `request.url`, a string; use `new URL(request.url)` when necessary.
- `req.params`, `req.cookies`, and `req.body` move to resolver properties and Fetch `Request` methods.
- `req.passthrough()` becomes `passthrough()`.
- `res.once()` becomes the response option `{ once: true }`.
- `res.networkError()` becomes `HttpResponse.error()`.
- `ctx.*` response utilities become `HttpResponse` APIs.
- `ctx.fetch(req)` becomes `fetch(bypass(request))`.
- `.printHandlers()` becomes `.listHandlers()`.

## Not covered

This skill does not cover Service Worker installation or browser build configuration, test-runner-specific setup, Jest environment configuration, Axios-specific examples, passthrough implementation details, handler inspection details, or GraphQL schema/client configuration. The research also does not document the exact signatures or behavior of every `HttpResponse` option, `graphql.link()`, `graphql.operation()`, or runtime handler mutation APIs.
