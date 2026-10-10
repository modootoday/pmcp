---
name: clickhouse-client
description: Use @clickhouse/client 1 in Node.js to insert rows, bind typed parameters, preserve large integers, consume results and close clients. Use for SDK-based ClickHouse work while respecting the project's authenticated connection factory and isolated test database policy.
---

# ClickHouse JavaScript Node client 1

Inspect installed SDK/server versions, the connection factory, schema and formats first. This line targets `@clickhouse/client@1.23.1`. Reuse the application's credential lifecycle; do not add raw HTTP queries or production credentials.

## Query with parameters

Create a client through the existing factory or `createClient` with explicitly selected URL, credentials and database. A Node client owns HTTP pooling; close it when its owning process finishes.

`keep_alive.enabled` is shared with the web SDK. Node additionally supports socket settings such as `keep_alive.idle_socket_ttl`, custom `http_agent` and TLS certificate buffers. Preserve the runtime-specific connection factory when sharing query code.

```ts
import { randomUUID } from "node:crypto";
import { createClient } from "@clickhouse/client";

type Row = { id: string; label: string };

export async function findRows(
  client: ReturnType<typeof createClient>,
  label: string,
) {
  const result = await client.query({
    query: "SELECT id, label FROM rows WHERE label = {label:String}",
    query_params: { label },
    format: "JSONEachRow",
    query_id: randomUUID(),
  });
  return await result.json<Row>();
}
```

Use ClickHouse typed placeholders such as `{label:String}` and `{id:UInt64}`. Do not interpolate values or copy `$1`/`?` conventions. `json<Row>()` supplies static types, not runtime validation.

## Insert and release

Use `client.insert({ table, values, format: "JSONEachRow" })` for arrays or documented Node readable streams. Use `command` for DDL and `query` for results. Preserve project table naming and insert settings.

UInt64/Int64 JSON results are strings by default. Keep values beyond JavaScript's safe integer range as strings or explicit bigint; avoid `Number(value)` and disabling quoted large integers. Precision-sensitive decimals need an explicit representation such as a `toString` expression and application validation.

Consume a result once via `json`, `text` or its stream. Node streams emit chunks of row wrappers; decode each with `row.json()`. Fully consume or close abandoned results, then close the owning client. A caller timeout is not proof the server operation stopped; query IDs support tracing and operational follow-up.

Use bounded `request_timeout` and server-side limits. Log query identity without credentials or sensitive parameters. SDK errors must remain visible rather than becoming fabricated empty results.

The fixture uses an explicit isolated loopback endpoint and unique temporary database through the SDK. It targets inserts, literal-safe parameters, UInt64 strings, Node streams, failure propagation and the companion web client, then drops only its database. It does not establish browser CORS, Worker deployment, TLS, failover, streaming inserts or server cancellation.

## Primary sources and upstream skill reuse

- [Official JS client documentation](https://clickhouse.com/docs/integrations/language-clients/js/index)
- [Official Node troubleshooting skill](https://github.com/ClickHouse/clickhouse-js/tree/2c9823bb27b428015cfb982d406381f2523429e7/skills/clickhouse-js-node-troubleshooting), Apache-2.0 licensed. Consult it for deeper Node troubleshooting; it excludes browser and Worker runtimes. These instructions are original text rather than copied upstream prose.
- [Upstream](https://github.com/ClickHouse/clickhouse-js)
