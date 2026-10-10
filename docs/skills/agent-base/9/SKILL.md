---
name: agent-base
description: Use agent-base 9 as an ESM adapter for Node's HTTP and HTTPS agent machinery.
---

Verified against agent-base@9.0.0 on 2026-09-08. 3 of 3 examples executed.

# agent-base

## Version and module shape

This skill targets `agent-base` 9.x. It is ESM-only and requires Node.js 20 or newer. Import the named `Agent` class and helpers:

```ts
import { Agent, json, req, toBuffer } from 'agent-base';
```

Do not use the old CommonJS/default-export form:

```js
const agent = require('agent-base');
```

That was the v6 shape. The v7 API removed the default export and introduced the named abstract `Agent` class.

## `Agent` subclass contract

`Agent` extends Node's `http.Agent`. A subclass must implement:

```ts
connect(
  req: http.ClientRequest,
  options: AgentConnectOpts
): Promise<Duplex | http.Agent> | Duplex | http.Agent;
```

`connect()` may return:

- a `Duplex` socket;
- another `http.Agent`, delegating connection handling; or
- a promise resolving to either of those.

The options include `secureEndpoint: boolean`, which distinguishes HTTPS from HTTP connection requests. The resulting agent is passed to Node's `http` or `https` APIs through their `{ agent }` option.

```ts pmcp-example
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { Agent } from 'agent-base';

class LocalAgent extends Agent {
  connect(_request: never, options: { secureEndpoint: boolean }) {
    assert.equal(options.secureEndpoint, false);
    return new PassThrough();
  }
}

const agent = new LocalAgent({ keepAlive: true });
assert.ok(agent instanceof Agent);
assert.equal(agent.options.keepAlive, true);

const socket = agent.connect({} as never, { secureEndpoint: false });
assert.ok(socket instanceof PassThrough);
```

The package is an adapter, not a request runner. In a real request, pass the subclass instance to Node's `http.get()` or `https.get()` as `{ agent }`. The connection implementation normally returns a socket created by the appropriate networking API, or returns another agent when delegation is needed.

Version 9's `createSocket` agent detection uses duck typing. This matters when delegating to agent implementations that are not instances of Node's `http.Agent`, such as `tunnel-agent`'s `TunnelingAgent`; do not rely on the older strict-instance behavior.

## `toBuffer()`

`toBuffer(readable)` consumes a readable stream and resolves to a `Buffer` containing its bytes. Provide Buffer or other byte chunks to the readable stream.

```ts pmcp-example
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { toBuffer } from 'agent-base';

const result = await toBuffer(
  Readable.from([Buffer.from('hello '), Buffer.from('world')]),
);
assert.ok(Buffer.isBuffer(result));
assert.equal(result.toString('utf8'), 'hello world');
```

## `json()`

`json(readable)` consumes a readable stream, decodes it as UTF-8, and parses it with `JSON.parse`.

```ts pmcp-example
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { json } from 'agent-base';

const value = await json(Readable.from([Buffer.from('{"ok":true,"count":2}') ]));
assert.deepEqual(value, { ok: true, count: 2 });
```

The input must contain valid JSON. Parsing failures reject with the error from `JSON.parse`.

## `req()`

`req(url, opts)` creates and ends an HTTP or HTTPS request based on the URL and returns the `http.ClientRequest` with a promise-like `.then` method. It is intended as a small request helper; the returned thenable resolves to the response.

This helper necessarily starts a real HTTP(S) request, so it is not demonstrated with a runnable example here: examples in this skill must run without network access. Use it only in an environment where the target URL is available, and provide request options as the second argument when needed.

## Common mistakes

- Importing a default export or using `require('agent-base')`; v9 uses the named ESM export `Agent`.
- Trying to instantiate `Agent` directly; it is abstract and requires a `connect()` implementation.
- Treating `connect()` as returning only a socket. It can return a socket, another agent, or a promise of either.
- Ignoring `options.secureEndpoint` when choosing HTTP versus HTTPS/TLS connection behavior.
- Passing string chunks to `toBuffer()` through a Node readable; use byte chunks such as `Buffer` or `Uint8Array`.
- Treating agent-base as a standalone request runner. It integrates with Node's `http` and `https` request machinery.
- Running package examples that use `describe`, `it`, or `expect` directly. Those are runner globals, not part of agent-base or a plain Node/Bun script.

## Not covered

This skill does not cover the internal details of Node's `http.Agent` pooling, custom proxy protocols, TLS option construction, `tunnel-agent` integration beyond the v9 duck-typing change, or network-backed usage of `req()`. It also does not cover package development commands or the package's test suite.
