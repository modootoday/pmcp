---
name: modelcontextprotocol-sdk
description: Build and test MCP v1 tools with @modelcontextprotocol/sdk, explicit Zod schemas, structured results, real client calls, and reliable transport cleanup. Keep v2 imports and protocol behavior separate.
compatibility: MCP TypeScript SDK 1.30.0 with Zod 3.25.76. Use a supported Node.js LTS release. The split server and client packages are a different SDK generation.
---

# MCP TypeScript SDK 1.x

Use this skill when the installed dependency is `@modelcontextprotocol/sdk` 1.x.
Inspect that dependency before selecting imports. The split
`@modelcontextprotocol/server` and `@modelcontextprotocol/client` 2.x packages
have different registration, schema, context and protocol contracts.

## Define a tool contract before its handler

Import `McpServer` from `@modelcontextprotocol/sdk/server/mcp.js` and `Client`
from `@modelcontextprotocol/sdk/client/index.js`. Use `registerTool` rather than
adding new calls to the deprecated variadic `tool` API.

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v3";

const server = new McpServer({ name: "items", version: "1.0.0" });
server.registerTool(
  "read-item",
  {
    description: "Read an item by its identifier",
    inputSchema: z.object({ itemId: z.string().min(1) }).strict(),
    outputSchema: z.object({ itemId: z.string(), title: z.string() }),
    annotations: { readOnlyHint: true },
  },
  async ({ itemId }) => {
    const item = { itemId, title: "Example item" };
    return {
      content: [{ type: "text", text: item.title }],
      structuredContent: item,
    };
  },
);
```

Use strict input only when unknown properties should be rejected. Schema
validation runs before the handler; test missing, wrong-type and unexpected
arguments. Tool annotations describe behavior and do not enforce permissions.
Keep authorization and side-effect limits in the application boundary.

## Separate tool failures from transport failures

Expected domain failures can return `isError: true` with readable `content`.
Inspect that flag after `client.callTool`; a resolved promise does not imply
the operation succeeded. In 1.30.0, invalid tool inputs also produce an error
tool result. Connection and protocol failures can still reject the call.

Successful structured output must satisfy `outputSchema`. A failure result
need not fabricate successful output fields. Avoid leaking secrets or internal
stack traces into model-visible error content.

## Test through an actual client

For an in-process v1 test, import `InMemoryTransport` from
`@modelcontextprotocol/sdk/inMemory.js`. Create a linked pair, connect the
server first, then connect the client to the other endpoint. Call `listTools`
and `callTool` through that client rather than invoking the handler directly.

Assert the advertised schema, successful `structuredContent`, `isError` for
invalid arguments and a domain failure, and that invalid calls never reach
the handler. Close the client and server in `finally`, including when an
assertion fails. Keep a deadline around the entire fixture.

Paired memory transport does not test stdio process management, HTTP security,
OAuth or a particular native host. The v1 line implements protocols through
2025-11-25; it does not gain 2026-07-28 support by changing an import.
For stdio, send protocol messages on stdout and diagnostics on stderr.

## Sources

- [Official v1 documentation and version boundary](https://ts.sdk.modelcontextprotocol.io/)
- [V1 server guide](https://ts.sdk.modelcontextprotocol.io/server.html)
- [V2 migration guide](https://ts.sdk.modelcontextprotocol.io/v2/migration/upgrade-to-v2.html)
