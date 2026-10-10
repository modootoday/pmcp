---
name: hono
description: Use Hono 4.x as a Fetch-compatible web application router. Covers the current Hono API, standalone request testing, middleware, context responses, validation, and migration traps from Hono 3.x.
---

Verified against hono@4.13.7 on 2026-09-07. 4 of 4 examples executed.

# Hono 4.x

## Use the current app API

Import the recommended preset from `hono`, construct an app, register routes, and export or pass the app to a runtime server:

```ts
import { Hono } from 'hono'

const app = new Hono()
app.get('/', (c) => c.text('Hello Hono!'))

export default app
```

Hono creates a Fetch-compatible app. Its runtime/server integration is separate. For Node.js, the documented integration uses `@hono/node-server` and `serve(app)`; Bun and Deno can serve Fetch handlers natively. Do not assume that importing `hono` starts an HTTP server.

For a standalone script, use `app.request()` to exercise routes without a server:

```ts pmcp-example
import { strict as assert } from 'node:assert'
import { Hono } from 'hono'

const app = new Hono()
app.get('/hello', (c) => c.text('Hello Hono!'))

const response = await app.request('/hello')
assert.equal(response.status, 200)
assert.equal(await response.text(), 'Hello Hono!')
```

`app.fetch(request, env, event)` is the Fetch-compatible handler API. `app.request(path, options)` is the convenient request helper for programmatic calls. Other documented app methods include HTTP method helpers, `all`, `on`, `use`, `route`, `basePath`, `notFound`, `onError`, `mount`, and `fire`.

## Context and responses

Route and middleware callbacks receive a context object. The documented context surface includes `c.req`, `c.status()`, `c.text()`, `c.json()`, `c.html()`, `c.set()`, `c.get()`, `c.var`, `c.header()`, `c.cookie()`, `c.redirect()`, `c.notFound()`, and `c.body()`.

Read request headers through `c.req.header()`, and set the response status with `c.status()` before returning a response:

```ts pmcp-example
import { strict as assert } from 'node:assert'
import { Hono } from 'hono'

const app = new Hono()
app.get('/created', (c) => {
  const userAgent = c.req.header('User-Agent')
  c.status(201)
  return c.json({ userAgent })
})

const response = await app.request('/created', {
  headers: { 'User-Agent': 'pmcp-example' },
})

assert.equal(response.status, 201)
assert.deepEqual(await response.json(), { userAgent: 'pmcp-example' })
```

Use `c.json()` rather than the removed `c.jsonT()` API.

## Middleware

Create custom middleware with `createMiddleware` from `hono/factory`. Middleware receives `(c, next)` and must await `next()` when it wants downstream handlers to run:

```ts pmcp-example
import { strict as assert } from 'node:assert'
import { Hono } from 'hono'
import { createMiddleware } from 'hono/factory'

const app = new Hono()

const addMarker = createMiddleware(async (c, next) => {
  c.set('marker', 'middleware')
  await next()
})

app.use(addMarker)
app.get('/', (c) => c.text(c.get('marker')))

const response = await app.request('/')
assert.equal(await response.text(), 'middleware')
```

The documented built-in middleware entry points include `logger` from `hono/logger` and `cors` from `hono/cors`, used as `app.use(logger())` and `app.use('/api/*', cors())`.

## Validation

Use `validator` from `hono/validator`. Documented validation targets are `form`, `json`, `query`, `header`, `cookie`, and `param`. A validator callback may return a response for invalid input or return validated data; later handlers retrieve it with `c.req.valid(target)`.

```ts pmcp-example
import { strict as assert } from 'node:assert'
import { Hono } from 'hono'
import { validator } from 'hono/validator'

const app = new Hono()

app.get(
  '/search',
  validator('query', (value, c) => {
    const term = value['term']
    if (!term || typeof term !== 'string') return c.text('Invalid!', 400)
    return { term }
  }),
  (c) => c.json(c.req.valid('query'))
)

const valid = await app.request('/search?term=hono')
assert.equal(valid.status, 200)
assert.deepEqual(await valid.json(), { term: 'hono' })

const invalid = await app.request('/search')
assert.equal(invalid.status, 400)
assert.equal(await invalid.text(), 'Invalid!')
```

## Hono 4 migration traps

When updating older examples, apply these changes:

- `c.jsonT()` was removed; use `c.json()`.
- `c.stream()` and `c.streamText()` moved to `hono/streaming`.
- `c.env()` was removed; use `getRuntimeKey()`.
- `app.handleEvent()` was removed; use `app.fetch()`.
- `app.showRoutes()` and `app.routerName` moved to `showRoutes()` and `getRouterName()` from `hono/dev`.
- `c.req.cookie()` was removed; use `getCookie()` from `hono/cookie`.
- `app.head()` is no longer needed because `app.get()` implicitly handles `HEAD`.
- Hono request members including `headers()`, `body()`, `bodyUsed()`, `integrity()`, `keepalive()`, `referrer()`, and `signal()` are now accessed on `req.raw`; for example, `req.raw.headers`.
- Cloudflare Workers `serveStatic` requires a manifest, passed as `{ root: './assets', manifest }`.
- JSX renderer `docType` now defaults to `true`.
- `FC` in `hono/jsx` no longer passes `children`; use `PropsWithChildren` when children are needed.

## Other entry points

The research documents these entry points:

- `hono/quick`: `Hono` for applications initialized per request.
- `hono/tiny`: the smallest router package.
- `hono/html`: `html` and `raw`.
- `hono/cookie`: `getCookie` and `setCookie`.
- `hono/testing`: `testClient`.
- `hono/adapter`: `env` and `getRuntimeKey`.

Use the documented exports from those subpaths rather than assuming they are methods on the app or context. In particular, cookie access moved out of `c.req`, and runtime-key access replaced `c.env()`.

## JSX and RPC boundaries

JSX requires a `.tsx` file and compiler configuration with `jsx: "react-jsx"` and `jsxImportSource: "hono/jsx"`; JSX is not a plain `.ts` feature.

RPC is type-level and build-tool dependent. The server exports `typeof route` as `AppType`; separate projects require matching Hono versions, strict TypeScript, project references, and compiled code before consumption. It is not something to validate with a bare `bun example.ts` script.

## Not covered

This skill does not specify the detailed signatures or standalone examples for every listed app method, the `quick` and `tiny` presets, HTML helpers, cookie helpers, `testClient`, adapter helpers, streaming, `hono/dev`, static serving, JSX components, RPC client construction, or runtime-specific server setup beyond the documented Node entry point. Consult the package documentation for those details; do not infer older-major APIs.
