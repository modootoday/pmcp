---
name: get-uri
description: Use get-uri 8.x to obtain readable streams from data, file, FTP, HTTP, and HTTPS URIs, or to validate supported protocols.
---

Verified against get-uri@8.0.1 on 2026-09-08. 4 of 4 examples executed.

# get-uri 8.x

## Runtime and module shape

- Requires Node.js 20 or newer.
- The package is ESM. Import named exports from `get-uri`:

```ts
import { getUri, isValidProtocol, protocols } from 'get-uri';
```

- The main API is `getUri(uri, options?)`, returning a `Promise<Readable>`.
- Accepted URI inputs are strings and `URL` objects.
- Supported protocols are `data`, `file`, `ftp`, `http`, and `https`.

## Get a readable stream

Use `getUri` when the caller needs a stream rather than a buffered value. The following uses a `data:` URI, so it requires no network or filesystem access:

```ts pmcp-example
import assert from 'node:assert/strict';
import { getUri } from 'get-uri';

const stream = await getUri('data:text/plain,hello');
let result = '';

for await (const chunk of stream) {
  result += chunk.toString();
}

assert.equal(result, 'hello');
```

A `URL` object is also accepted:

```ts pmcp-example
import assert from 'node:assert/strict';
import { getUri } from 'get-uri';

const stream = await getUri(new URL('data:text/plain,from-url'));
let result = '';

for await (const chunk of stream) {
  result += chunk.toString();
}

assert.equal(result, 'from-url');
```

For `file:` URIs, the resolved stream is an `fs.ReadStream`. HTTP and HTTPS produce streams from those protocols; FTP is also supported. Those protocols require resources outside a standalone, offline example.

## Protocol helpers

`isValidProtocol` is a type guard for the supported protocol names:

```ts pmcp-example
import assert from 'node:assert/strict';
import { isValidProtocol } from 'get-uri';

assert.equal(isValidProtocol('data'), true);
assert.equal(isValidProtocol('file'), true);
assert.equal(isValidProtocol('ftp'), true);
assert.equal(isValidProtocol('http'), true);
assert.equal(isValidProtocol('https'), true);
assert.equal(isValidProtocol('gopher'), false);
```

The `protocols` export exposes the individual protocol handlers. A handler receives a parsed `URL` and optional protocol-specific options:

```ts pmcp-example
import assert from 'node:assert/strict';
import { protocols } from 'get-uri';

const stream = await protocols.data(new URL('data:text/plain,direct'));
let result = '';

for await (const chunk of stream) {
  result += chunk.toString();
}

assert.equal(result, 'direct');
```

The available handlers are `protocols.data`, `protocols.file`, `protocols.ftp`, `protocols.http`, and `protocols.https`.

## Caching and errors

Pass a previous readable stream as `cache` in the options when using a protocol that supports caching. If the destination has not changed, the operation rejects with an error whose `code` is `"ENOTMODIFIED"`.

A missing resource rejects with an error whose `code` is `"ENOTFOUND"`.

Other options are passed through to the underlying protocol implementation, such as `http.get()` or `ftp.connect()`.

## Common version mistakes

- Do not use the older CommonJS shape or assume `require()` is the documented usage. get-uri 8.x is an ESM package.
- Do not target Node 14 or another pre-20 runtime. Version 8 raised the minimum Node.js version to 20.
- Do not expect only HTTP and HTTPS: `data`, `file`, and `ftp` are built in as well.
- Do not expect `getUri` to return the contents directly. Await it to obtain a `Readable` stream.
- Do not pass an ordinary protocol string to a protocol handler: the `protocols.*` functions take a parsed `URL`; use `getUri` when starting with a URI string.
- Do not assume an unchanged cached resource resolves normally; it rejects with `code === "ENOTMODIFIED"`.

## Not covered

This skill does not cover the protocol-specific option fields, HTTP authentication or headers, FTP connection configuration, filesystem behavior, stream error handling, or running the package through a CLI or test runner. The available research also does not specify the exact data-URI encoding forms beyond the standalone examples shown here.
