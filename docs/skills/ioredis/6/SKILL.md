---
name: ioredis
description: Use ioredis ^6.0.0 from Node.js 20+ for Redis commands, pipelines, Pub/Sub, Lua commands, streams, and RESP3-aware clients.
---

Verified against ioredis@6.0.0 on 2026-09-07. 5 of 5 examples executed.

# ioredis ^6.0.0

## Runtime and compatibility

- ioredis 6 requires Node.js `>=20`.
- The documented Redis range is Redis `6.2` through the latest release.
- The package exports TypeScript declarations.
- In CommonJS, use `require("ioredis")`. In TypeScript, prefer the named import `{ Redis }`.
- The default import is still supported, but is scheduled for deprecation in the next major version.
- `new Redis()` connects to `localhost:6379`.
- Redis URLs may use `redis://` or `rediss://`, including username, password, port, and database components.

## The v6 protocol and reply-shape trap

ioredis v6 opens connections with RESP3 by default and sends `HELLO 3`. If credentials are configured, authentication is included in that handshake. It falls back to RESP2 only for `NOPROTO` or unknown-command errors; other handshake errors fail the connection.

Code copied from v5 commonly assumes the old protocol or reply shapes. To preserve the v5 wire protocol, configure:

```ts
new Redis({ protocol: 2 })
```

The default `replyMapping: "legacy"` keeps v5/RESP2-compatible result shapes. With `protocol: 3` and `replyMapping: "resp3"`, replies use RESP3-oriented shapes:

- RESP3 maps become plain objects instead of flat arrays.
- RESP3 doubles become numbers instead of strings.
- RESP3 booleans become booleans instead of `0`/`1`.
- Sets remain arrays.
- Big numbers and verbatim strings remain strings.
- Command-specific transformers still apply.

For example, with `protocol: 3` and `replyMapping: "resp3"`, `CONFIG GET maxmemory` returns `{ maxmemory: "0" }` rather than `["maxmemory", "0"]`, and `ZSCORE` returns `1.5` rather than `"1.5"`.

## Basic commands

Commands return promises when the last argument is not a callback. They also support callbacks. The normal standalone shape is:

```ts
const redis = new Redis()
await redis.set("mykey", "value")
const value = await redis.get("mykey")
```

The callback form is also supported:

```ts
redis.get("mykey", (err, result) => {
  if (err) {
    console.error(err)
  } else {
    console.log(result)
  }
})
```

A Redis server is required for command execution. Close clients when the script is finished.

```ts pmcp-example
import { strict as assert } from "node:assert"
import { Redis } from "ioredis"

assert.equal(typeof Redis, "function")
assert.equal(typeof Redis.prototype.get, "function")
assert.equal(typeof Redis.prototype.set, "function")

const redis = new Redis("redis://127.0.0.1:6379")
assert.equal(typeof redis.get, "function")
assert.equal(typeof redis.set, "function")
redis.disconnect()
```

## Pipelining

`redis.pipeline()` returns a pipeline. Queue commands on it and call `exec()` to flush them. `exec()` also returns a promise.

```ts
const results = await redis
  .pipeline()
  .set("foo", "bar")
  .get("foo")
  .exec()
```

The callback form receives an array of responses corresponding to the queued commands. Each response has the form `[err, result]`; the pipeline-level `err` is documented as always `null`.

```ts pmcp-example
import { strict as assert } from "node:assert"
import { Redis } from "ioredis"

assert.equal(typeof Redis.prototype.pipeline, "function")

const redis = new Redis("redis://127.0.0.1:6379")
const pipeline = redis.pipeline()
assert.equal(typeof pipeline.set, "function")
assert.equal(typeof pipeline.get, "function")
assert.equal(typeof pipeline.exec, "function")
redis.disconnect()
```

## Pub/Sub

Use separate connections for subscriber and publisher roles. Once a connection subscribes, it enters subscriber mode.

```ts
const sub = new Redis()
const pub = new Redis()

sub.subscribe("my-channel-1", "my-channel-2")
sub.on("message", (channel, message) => {
  console.log(channel, message)
})
await pub.publish("my-channel-1", JSON.stringify({ foo: "bar" }))
```

Use `messageBuffer` when messages must be received as Buffers. Pattern subscriptions use `psubscribe()` and the `pmessage`/`pmessageBuffer` events.

```ts pmcp-example
import { strict as assert } from "node:assert"
import { Redis } from "ioredis"

assert.equal(typeof Redis.prototype.subscribe, "function")
assert.equal(typeof Redis.prototype.psubscribe, "function")
assert.equal(typeof Redis.prototype.publish, "function")

const subscriber = new Redis("redis://127.0.0.1:6379")
const publisher = new Redis("redis://127.0.0.1:6379")
assert.equal(typeof subscriber.on, "function")
assert.equal(typeof publisher.publish, "function")
subscriber.disconnect()
publisher.disconnect()
```

## Lua custom commands

`defineCommand()` adds a command to the client. ioredis uses `EVALSHA` when possible. A `myecho` command can declare its key count and Lua body:

```ts
redis.defineCommand("myecho", {
  numberOfKeys: 2,
  lua: "return {KEYS[1],KEYS[2],ARGV[1],ARGV[2]}"
})
```

The generated command accepts the keys and arguments. ioredis also creates a Buffer-returning variant named by adding `Buffer`, such as `myechoBuffer`.

```ts pmcp-example
import { strict as assert } from "node:assert"
import { Redis } from "ioredis"

assert.equal(typeof Redis.prototype.defineCommand, "function")

const redis = new Redis("redis://127.0.0.1:6379")
redis.defineCommand("myecho", {
  numberOfKeys: 2,
  lua: "return {KEYS[1],KEYS[2],ARGV[1],ARGV[2]}"
})
assert.equal(typeof redis.myecho, "function")
assert.equal(typeof redis.myechoBuffer, "function")
redis.disconnect()
```

## Streams

Use `XADD` to produce stream messages. The documented consumption pattern uses `XREAD` in an async consumer, with each message represented by an ID and field/value data.

```ts
await redis.xadd("mystream", "*", "randomValue", Math.random())
```

`XREAD` is used to consume messages, commonly from the last-seen ID. Stream reads also support the documented `MAXCOUNT` and `MAXSIZE` additions in v6.

```ts pmcp-example
import { strict as assert } from "node:assert"
import { Redis } from "ioredis"

assert.equal(typeof Redis.prototype.xadd, "function")
assert.equal(typeof Redis.prototype.xread, "function")

const redis = new Redis("redis://127.0.0.1:6379")
assert.equal(typeof redis.xadd, "function")
assert.equal(typeof redis.xread, "function")
redis.disconnect()
```

## Common mistakes

- Do not assume v5's RESP2 wire protocol is still the default. v6 defaults to RESP3; use `{ protocol: 2 }` when preserving v5 protocol behavior.
- Do not assume every reply has its v5 shape. The default legacy mapping preserves compatibility, while `{ protocol: 3, replyMapping: "resp3" }` changes maps, doubles, and booleans.
- Do not use one connection for both subscription and ordinary publishing. Create separate subscriber and publisher clients.
- Do not expect commands to run without a reachable Redis server. `new Redis()` connects to localhost by default.
- Do not forget that pipeline results are per-command `[err, result]` pairs rather than a single ordinary command result.
- Do not use a runner-injected `describe`, `it`, or `expect` in a direct script. The package is a Redis client; direct scripts use its programmatic API.
- Do not copy the older default-import style into new TypeScript code when the named `{ Redis }` import is available; the default import is supported now but is planned for deprecation in the next major.

## Not covered

This skill does not cover Redis server installation or configuration, command-by-command Redis semantics, cluster setup, Sentinel, connection-retry tuning, transactions, locks, binary encoding beyond the documented Buffer variants, TypeScript compiler configuration, or ioredis's maintainer build/test/documentation commands. The examples only verify the directly exposed client surface without requiring a Redis server; command execution, Pub/Sub delivery, Lua evaluation, and stream consumption require a reachable Redis instance.
