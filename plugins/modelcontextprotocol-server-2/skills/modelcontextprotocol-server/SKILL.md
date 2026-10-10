---
name: modelcontextprotocol-server
description: Expose MCP tools with @modelcontextprotocol/server 2.x using Standard Schema inputs, explicit result contracts, per-request server factories, and credential-free in-process HTTP tests.
compatibility: MCP server 2.0.0 with client 2.0.0 and Zod 4.6.5. These packages require Node.js 20 or newer; use a supported LTS release.
---

# MCP TypeScript server 2.x

Use the split `@modelcontextprotocol/server` package for SDK v2. Do not rewrite
imports from v1 and assume its callback context or wire behavior is unchanged.
Keep server creation, transport selection and application services separate.

## Register explicit Standard Schema contracts

Use `McpServer` and `registerTool` with a complete schema object. Zod 4.2 or
later supplies the Standard Schema JSON conversion expected by this SDK.
The 2.0.0 fixture uses Zod 4.6.5. A raw field map is a deprecated compatibility
overload, not the preferred v2 contract.

```ts
import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod/v4";

function createServer() {
  const server = new McpServer({ name: "items", version: "1.0.0" });
  server.registerTool(
    "read-item",
    {
      description: "Read an item by its identifier",
      inputSchema: z.object({ itemId: z.string().min(1) }).strict(),
      outputSchema: z.object({ itemId: z.string(), title: z.string() }),
      annotations: { readOnlyHint: true },
    },
    async ({ itemId }) => ({
      content: [{ type: "text", text: "Example item" }],
      structuredContent: { itemId, title: "Example item" },
    }),
  );
  return server;
}
```

Choose strict input deliberately; otherwise a schema can silently discard
unknown keys. Test that rejected inputs do not execute the handler. Validate
successful structured output and return `isError: true` for expected domain
failures instead of fabricating successful fields.

A tool without an input schema receives context as its single callback argument.
Do not interpret that context as an empty argument object. V2 HTTP request
headers are accessed through Web Standard `Headers`, not a v1 header record.
Annotations are hints, not application authorization.

## Keep serving and integration tests distinct

`createMcpHandler(createServer)` exposes a Web Standard Fetch handler. Pass
its `fetch` to a real `StreamableHTTPClientTransport` for in-process tests;
there is no listening socket or provider account involved. For a modern-only
fixture, `{ legacy: "reject" }` prevents an accidental 2025-era fallback.

Assert the negotiated era/version, advertised tool schema, valid structured
result, strict argument errors and domain errors. Close the client first and
then the handler in nested `finally` blocks. Bound the whole process so an
unresolved request cannot retain resources indefinitely.

`InMemoryTransport.createLinkedPair()` remains useful for legacy instances,
but it does not establish 2026-07-28 coverage. Prefer the handler's Fetch path
when testing that protocol. A factory can create separate server instances;
inject shared application services explicitly and avoid treating handler-local
state as a durable session store.

Deployment still needs the appropriate runtime adapter, host/origin checks,
authorization and resource limits. An in-process test does not verify those
controls or OAuth. For a stdio service, use the package's `/stdio` entry and
keep diagnostic output off stdout.

## Sources

- [Official v2 server entry point](https://ts.sdk.modelcontextprotocol.io/v2/)
- [In-process server testing](https://ts.sdk.modelcontextprotocol.io/v2/testing.html)
- [V1 to v2 migration](https://ts.sdk.modelcontextprotocol.io/v2/migration/upgrade-to-v2.html)
