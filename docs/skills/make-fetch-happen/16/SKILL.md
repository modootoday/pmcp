---
name: make-fetch-happen
description: Use make-fetch-happen ^16.0.0 for fetch-compatible HTTP requests with caching, retries, proxy support, integrity verification, DNS caching, and Node.js transport options.
---

Verified against make-fetch-happen@16.0.1 on 2026-09-08. 2 of 2 examples executed.

# make-fetch-happen v16

## Runtime and import

Version 16.0.0 requires Node `^22.22.2 || ^24.15.0 || >=26.0.0`. It is directly loadable with CommonJS:

```js
const fetch = require('make-fetch-happen')
```

The package exports the main fetch function plus `FetchError`, `Headers`, `Request`, and `Response`.

The main call is:

```js
fetch(uriOrRequest, opts) // Promise<Response>
```

`uriOrRequest` may be a URI string or a `Request` object. The returned `Response` follows the fetch-style API, including methods such as `json()`, `text()`, and `buffer()`.

## Defaults and caching

Use `.defaults()` to create a fetch function with default options:

```js
const fetch = require('make-fetch-happen').defaults({
  cachePath: './my-cache'
})
```

A defaulted fetch function also has `.defaults()`. The overload accepts an optional default URL followed by default options.

`cachePath` is required for cache behavior. Setting `cache` without a `cachePath` does nothing. Cached response bodies are written only after the response body is consumed, for example with `res.json()`, `res.buffer()`, or by draining `res.body`.

Useful cache modes include:

- `no-cache`: force a conditional request when a cached response is available.
- `only-if-cached`: do not use the network. It produces a network error when no cached response exists and can only be used when the request mode is `same-origin`.

Do not assume that receiving a `Response` means its body has been cached; consume the body first.

## Retry behavior

The `retry` option may be:

- `false`, disabling retries;
- a number, specifying the retry count;
- an object with `retries`, `factor`, `minTimeout`, `maxTimeout`, and `randomize`.

`onRetry(cause)` receives the response or error that caused a retry.

```js
fetch('https://example.invalid', {
  retry: {
    retries: 10,
    randomize: true
  },
  onRetry (cause) {
    console.error('retrying because of', cause)
  }
})
```

Do not use `retry: 3` when retries must be disabled; use `retry: false`.

## Integrity verification

Pass an `integrity` value to verify the response body. A mismatch fails with an error whose code is `EINTEGRITY`.

```js
fetch('https://registry.npmjs.org/make-fetch-happen/-/make-fetch-happen-1.0.0.tgz', {
  integrity: 'sha1-o47j7zAYnedYFn1dF/fR9OV3z8Q='
})
```

Integrity applies to the response body, so handle the rejected promise rather than expecting a successful response with a bad body.

## Other request options

Options from `minipass-fetch` are used as-is, including `method`, `body`, `redirect`, `follow`, `timeout`, `compress`, and `size`.

Additional options include:

- `cachePath`, `cache`, and `cacheAdditionalHeaders`
- `proxy` and `noProxy`
- `ca`, `cert`, `key`, and `strictSSL`
- `localAddress` and `maxSockets`
- `retry` and `onRetry`
- `integrity`
- `dns` and `agent`

Proxy handling can fall back to `HTTP_PROXY`, `HTTPS_PROXY`, and `PROXY` from the environment. `noProxy` can use `NO_PROXY`.

## Standalone fetch-compatible classes

The exported `Headers`, `Request`, and `Response` classes can be used from a plain script without a test runner or framework globals:

```ts pmcp-example
import assert from 'node:assert/strict'

const {
  Headers,
  Request,
  Response
} = require('make-fetch-happen')

const headers = new Headers({
  'content-type': 'application/json',
  'x-example': 'yes'
})

assert.equal(headers.get('content-type'), 'application/json')
assert.equal(headers.get('x-example'), 'yes')

const request = new Request('https://example.invalid/data', {
  method: 'POST',
  headers,
  body: JSON.stringify({ input: 1 })
})

assert.equal(request.method, 'POST')
assert.equal(request.url, 'https://example.invalid/data')
assert.equal(request.headers.get('x-example'), 'yes')

const response = new Response(JSON.stringify({ ok: true }), {
  status: 201,
  headers: { 'content-type': 'application/json' }
})

assert.equal(response.status, 201)
assert.equal(response.headers.get('content-type'), 'application/json')
assert.deepEqual(await response.json(), { ok: true })
```

## Creating configured fetch functions without making a request

`.defaults()` is available on the package export and on functions returned by `.defaults()`. This can be checked without a network request or filesystem access:

```ts pmcp-example
import assert from 'node:assert/strict'
import makeFetchHappen from 'make-fetch-happen'

const withDefaults = makeFetchHappen.defaults({
  cachePath: './cache',
  retry: false
})

assert.equal(typeof makeFetchHappen, 'function')
assert.equal(typeof withDefaults, 'function')
assert.equal(typeof withDefaults.defaults, 'function')

const withUrl = makeFetchHappen.defaults('https://example.invalid', {
  retry: false
})

assert.equal(typeof withUrl, 'function')
assert.equal(typeof withUrl.defaults, 'function')
```

The actual fetch operation, cache reads and writes, retry callbacks, proxy behavior, DNS caching, and integrity verification require an HTTP response or transport environment. Exercise those through the application or tool that supplies the network and operational conditions; this skill does not use a network or filesystem in its standalone examples.

## What this skill does not cover

This skill does not cover the package's internal cache layout, every HTTP status or retry decision, detailed proxy and DNS resolution rules, agent implementation details, stream-level APIs beyond body consumption, or package-maintenance commands. It also does not cover standalone network-fetch examples, cache integration tests, or the exact behavior of all exported error and transport types.
