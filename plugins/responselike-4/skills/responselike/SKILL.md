---
name: responselike
description: Use responselike ^4.0.0 to construct a Node.js readable HTTP-like response with status, headers, body, and URL metadata.
---

Verified against responselike@4.0.2 on 2026-09-08. 5 of 5 examples executed.

# responselike

## What this package provides

`responselike` v4.0.0 exports a default `Response` class. It is an ESM package and requires Node.js 20 or newer. `Response` extends Node’s readable stream and represents an HTTP-like response with metadata plus a streamable body.

```ts pmcp-example
import assert from 'node:assert/strict';
import Response from 'responselike';

const response = new Response({
  statusCode: 200,
  headers: {
    'Content-Type': 'text/plain',
    'X-Request-Id': 'abc123'
  },
  body: Buffer.from('Hi!'),
  url: 'https://example.com'
});

assert.equal(response.statusCode, 200);
assert.deepEqual(response.headers, {
  'content-type': 'text/plain',
  'x-request-id': 'abc123'
});
assert.deepEqual(response.body, Buffer.from('Hi!'));
assert.equal(response.url, 'https://example.com');
```

## Constructing a response

Pass an options object containing:

- `statusCode`: a number
- `headers`: an object whose values are strings
- `body`: a `Buffer` or other `Uint8Array`
- `url`: the request URL string

Header keys are automatically lowercased. Do not preserve the casing from the input when looking up headers.

```ts pmcp-example
import assert from 'node:assert/strict';
import Response from 'responselike';

const response = new Response({
  statusCode: 201,
  headers: {
    Location: '/items/1',
    'Content-Length': '0'
  },
  body: new Uint8Array(),
  url: 'https://example.com/items'
});

assert.equal(response.statusCode, 201);
assert.equal(response.headers.location, '/items/1');
assert.equal(response.headers['content-length'], '0');
assert.equal(response.headers.Location, undefined);
assert.deepEqual(response.body, Buffer.alloc(0));
assert.equal(response.url, 'https://example.com/items');
```

The constructor validates the status code, headers, body, and URL. A `Uint8Array` body is accepted even though the TypeScript `Options` declaration specifies `Buffer`.

```ts pmcp-example
import assert from 'node:assert/strict';
import Response from 'responselike';

const valid = {
  statusCode: 200,
  headers: {},
  body: Buffer.from('body'),
  url: 'https://example.com'
};

assert.throws(() => new Response({...valid, statusCode: '200'}));
assert.throws(() => new Response({...valid, body: 'body'}));
assert.throws(() => new Response({...valid, url: 123}));
```

The runtime accepts an object-shaped headers value such as an empty array; do not rely on an array being rejected merely because the TypeScript declaration describes headers as `Record<string, string>`.

## Reading the body as a stream

The same bytes are available through `response.body` and through the inherited readable-stream interface. Consume the stream with normal Node.js stream APIs or async iteration.

```ts pmcp-example
import assert from 'node:assert/strict';
import Response from 'responselike';

const response = new Response({
  statusCode: 200,
  headers: {},
  body: Buffer.from('streamed body'),
  url: 'https://example.com'
});

const chunks = [];
for await (const chunk of response) {
  chunks.push(chunk);
}

assert.deepEqual(Buffer.concat(chunks), Buffer.from('streamed body'));
assert.equal(response.complete, true);
```

The v4 implementation delays stream completion until a subsequent read. This allows consumers to attach listeners before data flows through pipes and fixes hanging when the response is piped through `decompress-response`. It also sets `complete` to `true` after the stream emits `end`, as required by `mimic-response`.

## Piping

Because `Response` is a Node readable stream, it can be piped to a writable stream. The package does not provide a CLI or test-runner environment; use it from ordinary Node.js ESM code.

```ts pmcp-example
import assert from 'node:assert/strict';
import {Writable} from 'node:stream';
import Response from 'responselike';

const response = new Response({
  statusCode: 200,
  headers: {},
  body: Buffer.from('piped'),
  url: 'https://example.com'
});

const received = [];
const destination = new Writable({
  write(chunk, encoding, callback) {
    received.push(Buffer.from(chunk));
    callback();
  }
});

await new Promise((resolve, reject) => {
  destination.once('finish', resolve);
  destination.once('error', reject);
  response.pipe(destination);
});

assert.deepEqual(Buffer.concat(received), Buffer.from('piped'));
assert.equal(response.complete, true);
```

## v4 migration notes

- v4 requires Node.js 20. Code written for v3 may have required only Node.js 14.16 or newer.
- The existing default-import and constructor shape remains valid:

  ```js
  import Response from 'responselike';
  const response = new Response({statusCode, headers, body, url});
  ```

- Use the ESM default import shown above rather than expecting a CLI or a package runner.
- The v4 stream-completion behavior is important when integrating with `decompress-response` or `mimic-response`; consume or pipe the response as a stream rather than assuming that merely constructing it has ended the stream.

## TypeScript surface

TypeScript can import the `Options` type and the default `Response` class. The declared options are readonly and use `Buffer` for `body`:

```ts
import Response, {type Options} from 'responselike';
```

## Not covered

This skill does not cover constructor defaults when options are omitted, exact validation error messages, HTTP client integration, `decompress-response` configuration, `mimic-response` usage details, or the package’s development-only `xo`, `ava`, and `tsd` commands.
