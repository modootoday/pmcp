---
name: express
description: Use Express 5.x programmatically on Node.js 18+; covers the Express app, routers, body middleware, Express 5 routing, and migration differences.
---

Verified against express@5.2.1 on 2026-09-08. 6 of 6 examples executed.

# Express 5

Express `^5.0.0` requires Node.js 18 or newer. Import the package and call the exported function to create an application:

```ts pmcp-example
import express from 'express'
import assert from 'node:assert/strict'

const app = express()

assert.equal(typeof express, 'function')
assert.equal(typeof app, 'function')
assert.equal(typeof app.get, 'function')
assert.equal(typeof app.post, 'function')
assert.equal(typeof app.put, 'function')
assert.equal(typeof app.delete, 'function')
assert.equal(typeof app.patch, 'function')
assert.equal(typeof app.options, 'function')
assert.equal(typeof app.head, 'function')
assert.equal(typeof app.all, 'function')
assert.equal(typeof app.use, 'function')
assert.equal(typeof app.listen, 'function')
```

The application is itself a request handler and can be passed to Node's HTTP server APIs. `app.listen(...)` returns an `http.Server`. A plain script does not need an Express-specific runner or build step. These examples do not start a server because they must run without network access.

## Middleware factories

The documented top-level middleware factories return middleware functions:

- `express.json(options)` parses JSON bodies.
- `express.raw(options)` parses request payloads into a `Buffer`.
- `express.text(options)` parses text bodies.
- `express.urlencoded(options)` parses URL-encoded bodies.
- `express.static(root, options)` serves static files.

```ts pmcp-example
import express from 'express'
import assert from 'node:assert/strict'

assert.equal(typeof express.json(), 'function')
assert.equal(typeof express.json({}), 'function')
assert.equal(typeof express.raw(), 'function')
assert.equal(typeof express.text(), 'function')
assert.equal(typeof express.urlencoded({ extended: true }), 'function')
assert.equal(typeof express.static('public'), 'function')
```

In Express 5, `express.urlencoded()` defaults `extended` to `false`; specify `{ extended: true }` when that is required. If no body parser handles the request, `req.body` is `undefined`. `express.raw()` produces a `Buffer`.

```ts pmcp-example
import express from 'express'
import assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'

const request = new PassThrough()
request.headers = {
  'content-type': 'application/json',
  'content-length': '11'
}
request.method = 'POST'
request.url = '/profile'

const response = {
  setHeader() {},
  getHeader() { return undefined },
  removeHeader() {},
  end() {}
}

let parsed: unknown
express.json()(request, response, (error?: unknown) => {
  assert.equal(error, undefined)
  parsed = request.body
})
request.end('{"ok":true}')

await new Promise((resolve) => setImmediate(resolve))
assert.deepEqual(parsed, { ok: true })
```

## Routers

`express.Router(options)` returns a router. The documented options are `caseSensitive`, `mergeParams`, and `strict`. Mount it with `app.use()`:

```ts pmcp-example
import express from 'express'
import assert from 'node:assert/strict'

const app = express()
const router = express.Router({
  caseSensitive: true,
  mergeParams: true,
  strict: true
})

router.get('/', (_req, res) => res.send('hello world'))
app.use('/api', router)

assert.equal(typeof router, 'function')
assert.equal(typeof router.get, 'function')
assert.equal(typeof router.use, 'function')
assert.equal(typeof app.use, 'function')
```

## Express 5 route syntax

Express 5 uses the newer `path-to-regexp` route syntax. Do not retain the common Express 4 string-path forms:

- Use `/*splat` instead of `/*`.
- Use `/{*splat}` when the wildcard should also match the root path.
- Use `/:file{.:ext}` instead of `/:file.:ext?`.
- Parameter names must be valid JavaScript identifiers or quoted names.
- `?`, regexp characters, and several reserved characters are not accepted in string paths as they were in older forms.

```ts pmcp-example
import express from 'express'
import assert from 'node:assert/strict'

const app = express()

app.get('/*splat', (_req, res) => res.send('wildcard'))
app.get('/{*splat}', (_req, res) => res.send('root-or-wildcard'))
app.get('/:file{.:ext}', (_req, res) => res.send('file'))

assert.equal(typeof app.get, 'function')
```

## Async handlers and errors

Rejected promises from middleware and route handlers are forwarded to error middleware in Express 5. An `async` handler can therefore stand alone; the Express 4 `.catch(next)` pattern is not required.

```ts pmcp-example
import express from 'express'
import assert from 'node:assert/strict'

const app = express()

app.get('/user/:id', async (_req, _res) => {
  throw new Error('lookup failed')
})

app.use((error, _req, res, _next) => {
  assert.equal(error.message, 'lookup failed')
  res.status(500).send('handled')
})

assert.equal(typeof app, 'function')
```

This example registers the behavior but does not issue a network request. The complete request lifecycle is exercised through the HTTP server in the surrounding application or tool.

## Express 5 migration pitfalls

- Use `app.delete()`, not the removed `app.del()`.
- Use `res.status(200).send(body)`, not `res.send(body, status)`.
- `res.redirect('back')` and `res.location('back')` are removed; use `req.get('Referrer') || '/'` explicitly, for example `res.redirect(req.get('Referrer') || '/')`.
- `app.param(fn)` and `router.param(fn)` are removed forms.
- Singular method aliases are removed.
- `app.router` is available again as a reference to the base router.
- `app.listen(..., callback)` passes server errors to the callback rather than throwing them.
- Brotli request-body decompression is supported.

## Static files

`express.static(root, options)` uses `root` and `dotfiles`, not the old `from` and `hidden` options. `dotfiles` defaults to `"ignore"`; explicitly opt in with `{ dotfiles: 'allow' }` when serving hidden paths such as `/.well-known`.

`express.static.mime` is gone; use `mime-types` instead. Static-file behavior requires an application filesystem and is not exercised by the standalone examples here.

## Not covered

This skill does not cover Node HTTP server lifecycle details, network-based integration tests, filesystem fixtures for static files, the complete request and response object API, every middleware option, deployment configuration, or optional migration codemods. Those require the surrounding application/tool or information not present in the supplied research.
