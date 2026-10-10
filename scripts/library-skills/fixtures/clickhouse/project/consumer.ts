import { Readable } from "node:stream";
import { createClient as createNodeClient } from "@clickhouse/client";
import { createClient as createWebClient } from "@clickhouse/client-web";

type Row = { id: string; label: string };

export async function readNode(url: string): Promise<Row[]> {
  const client = createNodeClient({
    url,
    keep_alive: { enabled: true, idle_socket_ttl: 2500 },
  });
  try {
    const result = await client.query({
      query: "SELECT id, label FROM rows",
      format: "JSONEachRow",
    });
    return await result.json<Row>();
  } finally {
    await client.close();
  }
}

export async function readWeb(url: string): Promise<Row[]> {
  const client = createWebClient({ url, keep_alive: { enabled: true } });
  try {
    const result = await client.query({
      query: "SELECT id, label FROM rows",
      format: "JSONEachRow",
    });
    return await result.json<Row>();
  } finally {
    await client.close();
  }
}

export function rejectNodeOnlyWebOptions(url: string) {
  return createWebClient({
    url,
    keep_alive: {
      enabled: true,
      // @ts-expect-error Socket idle TTL is Node-specific; enabled is shared.
      idle_socket_ttl: 2500,
    },
  });
}

export function rejectNodeStreamInsert(url: string) {
  const client = createWebClient({ url });
  return client.insert({
    table: "rows",
    format: "JSONEachRow",
    // @ts-expect-error The web client does not accept a Node readable insert stream.
    values: Readable.from([{ id: "1", label: "one" }]),
  });
}
