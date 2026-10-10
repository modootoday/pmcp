---
name: ioredis
description: Use ioredis 5 for Redis connections, commands, pipelines, transactions, Pub/Sub and shutdown. Use for Node Redis integrations and BullMQ connection policies while preserving existing configuration and avoiding ioredis 6 RESP3 options.
---

# ioredis 5

Inspect the installed major, endpoint source, connection ownership and retry settings first. This line targets ioredis 5.11.1. Reuse the project's connection factory; do not introduce another endpoint or change shared server settings.

## Choose connection policy

A request producer should fail within the caller's budget when Redis is unavailable. A long-lived BullMQ worker needs `maxRetriesPerRequest: null`; an existing ioredis connection supplied to a worker must already have it. Preserve the application's reconnect strategy and monitoring.

```ts
import Redis from "ioredis";

export function createProducer(
  redisUrl: string,
  reportError: (error: Error) => void,
) {
  const client = new Redis(redisUrl, {
    lazyConnect: true,
    connectTimeout: 2000,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
  });
  client.on("error", reportError);
  return client;
}

export async function increment(client: Redis, key: string) {
  const results = await client
    .pipeline()
    .set(key, "1")
    .incr(key)
    .get(key)
    .exec();
  if (!results) throw new Error("Pipeline did not return results");
  for (const [error] of results) {
    if (error) throw error;
  }
  return results[2][1];
}
```

For a lazy client, await `connect()` before commands with offline queuing disabled. `connectTimeout` bounds one attempt; retries, command timeouts and the caller's deadline determine the overall budget. `maxRetriesPerRequest: 1` alone does not guarantee a wall-clock timeout.

## Interpret results and modes

- `pipeline().exec()` returns one error/result pair per command. Inspect each pair; a resolved promise does not mean every command succeeded. Pipelines are not transactions.
- `multi().exec()` runs a Redis transaction. Redis does not roll back successful commands when another command has a runtime error; inspect individual results.
- Use a separate subscriber connection. Register its listener, await `subscribe`, then publish. A subscribed connection is not a general command connection.
- Allocate a unique test namespace and delete only owned keys. Do not use `FLUSHDB`, global deletion or shared server configuration changes for routine test setup.

Use `quit()` for orderly shutdown and `disconnect()` to stop reconnects when forced cleanup is necessary. Close BullMQ consumers before their connections. Ownership belongs to the creator; do not suppress connection errors or log credential-bearing URLs.

The isolated fixture targets real commands, per-command errors, transactions, Pub/Sub, fail-fast writes and worker reconnection through a local TCP fault proxy. It uses an explicit loopback test endpoint and unique namespace. It does not prove Sentinel, Cluster, TLS, production failover or RESP3 behavior.

## Primary sources and upstream skill reuse

- [Pinned ioredis 5 README](https://github.com/redis/ioredis/blob/v5.11.1/README.md)
- [BullMQ connections](https://docs.bullmq.io/guide/connections)
- [Official Redis connection skill](https://github.com/redis/agent-skills/blob/d3d89fae1110012741e07b46926e91119d31e0e7/skills/redis-connections/SKILL.md), MIT licensed. Its other-language/RESP3 examples are not ioredis 5 APIs. These instructions are original text rather than copied upstream prose.
