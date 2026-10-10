---
name: clickhouse-client-web
description: Use @clickhouse/client-web 1 in Fetch/Web Streams environments to insert arrays, bind typed parameters and consume query results. Use when porting Node ClickHouse code without copying Node streams, HTTP agents or privileged credentials into the browser boundary.
---

# ClickHouse JavaScript web client 1

Inspect the installed client, runtime, credential boundary and connection factory first. This line targets `@clickhouse/client-web@1.23.1`. Node Fetch availability does not prove browser CORS or Worker deployment.

## Use the web contract

Import from `@clickhouse/client-web`. Parameter and JSON format conventions match the Node SDK; transport options and stream types do not.

```ts
import { createClient } from "@clickhouse/client-web";

type Row = { id: string; label: string };

export async function findRows(
  client: ReturnType<typeof createClient>,
  label: string,
) {
  const result = await client.query({
    query: "SELECT id, label FROM rows WHERE label = {label:String}",
    query_params: { label },
    format: "JSONEachRow",
  });
  return await result.json<Row>();
}
```

Use arrays for `insert({ table, values, format: "JSONEachRow" })`. The web client does not accept Node or Web readable insert streams. `keep_alive.enabled` is a shared option; Node socket settings such as `keep_alive.idle_socket_ttl`, custom `http_agent` and TLS certificate buffers are outside the web configuration contract.

## Consume Web Streams

`result.stream()` returns a WHATWG `ReadableStream` of chunks of row wrappers. Read with `getReader()` and decode each row with `row.json()`. Fully consume and release the reader lock in `finally`; when stopping early, cancel before releasing the lock. Do not consume a result again through `json` or `text`.

Preserve UInt64/Int64 string values. `json<Row>()` does not validate runtime data. Bound query results rather than buffering unbounded output into an array.

## Keep credentials at the runtime boundary

A server-side edge worker can use platform secrets. Browser-delivered code cannot keep a database password secret; use an authenticated server endpoint or an explicitly authorized public-data service. Do not embed privileged credentials in frontend environment substitutions. Browser access also needs intentional CORS; the SDK does not bypass it.

Use the SDK for data operations and preserve the project's authentication factory. Close clients at their owning lifecycle boundary and route SDK failures through the application error policy.

The fixture runs this SDK under Node Fetch/Web Streams against an isolated database. It targets array inserts, parameterized JSON queries and stream consumption. Its consumer typecheck accepts shared `keep_alive.enabled` and rejects Node socket idle TTL and Node readable insert values. It does not run a browser, CORS policy, Worker binding, TLS configuration or streaming insert.

## Primary sources and provenance

- [Official JS client documentation](https://clickhouse.com/docs/integrations/language-clients/js/index)
- [Web client upstream](https://github.com/ClickHouse/clickhouse-js/tree/main/packages/client-web)
- [Official Node troubleshooting skill](https://github.com/ClickHouse/clickhouse-js/tree/2c9823bb27b428015cfb982d406381f2523429e7/skills/clickhouse-js-node-troubleshooting), Apache-2.0 licensed. Its Node-only scope is a boundary reference rather than web evidence. These web instructions are original text.
