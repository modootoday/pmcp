---
name: modelcontextprotocol-client
description: Connect @modelcontextprotocol/client 2.x to MCP servers, inspect negotiated protocol and advertised tools, handle structured and error results, and close client resources reliably.
compatibility: MCP client 2.0.0 with server 2.0.0 for local integration fixtures. The split client requires Node.js 20 or newer; use a supported LTS release.
---

# MCP TypeScript client 2.x

Use `Client` from `@modelcontextprotocol/client`. The v1
`@modelcontextprotocol/sdk/client/index.js` import is a different package line.
Pick the transport according to the server endpoint rather than treating every
MCP server as a subprocess.

## Connect, inspect, call, and close

```ts
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";

const client = new Client(
  { name: "items-client", version: "1.0.0" },
  { versionNegotiation: { mode: "auto" } },
);
const transport = new StreamableHTTPClientTransport(endpoint);

try {
  await client.connect(transport);
  const available = await client.listTools();
  const result = await client.callTool({
    name: "read-item",
    arguments: { itemId: "42" },
  });
  if (result.isError) throw new Error("The item operation failed");
  consumeResult(available, result.structuredContent);
} finally {
  await client.close();
}
```

The application supplies `endpoint` and `consumeResult`. Discover tools before
depending on their names and shapes. Use the tool's advertised contract and
validate data at the application boundary; a TypeScript cast does not validate
an unfamiliar server's output.

Inspect `getProtocolEra()` and `getNegotiatedProtocolVersion()` after connecting
when behavior depends on the negotiated protocol. An installed v2 client can
connect to a legacy server, so the package version alone is insufficient.
Use operation deadlines and explicit retry rules for side-effecting tools;
repeating a timed-out call can duplicate work.

## Handle both kinds of failure

Expected tool failures resolve with `isError: true` and model-readable `content`.
Do not consume their `structuredContent` as successful application data.
Transport or protocol failures may reject. Preserve useful error context
without logging credential headers or access tokens.

Strict schemas can reject missing, wrong-type and unknown arguments. Fix the
caller according to the discovered contract rather than weakening validation
to make a test pass. Read-only annotations describe the server's intent; they
do not authorize calls on the user's behalf.

## Test without contacting an endpoint

Inject a custom transport `fetch` that constructs a `Request` and passes it to
`createMcpHandler` from `@modelcontextprotocol/server`. The URL is an identifier
in this fixture; the injected function must never fall back to network fetch.
Use a modern-only handler and assert the negotiated protocol, tool discovery,
successful data and invalid argument/domain error results.

Close the client, then the handler, even when an assertion fails. This fixture
exercises actual HTTP serialization in-process. Paired memory transport covers
2025-era behavior; it does not prove modern protocol support. Neither fixture
proves OAuth, remote endpoint security or stdio child lifecycle.

Keep provider authentication in the documented client auth integration. Do not
copy native runtime account files into a fixture or reinterpret a tool error
as a reason to replace an OAuth session.

## Sources

- [Official client and transport documentation](https://ts.sdk.modelcontextprotocol.io/v2/)
- [Credential-free client/server roundtrip](https://ts.sdk.modelcontextprotocol.io/v2/testing.html)
- [Version and API migration boundaries](https://ts.sdk.modelcontextprotocol.io/v2/migration/upgrade-to-v2.html)
