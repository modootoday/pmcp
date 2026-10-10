import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { createServer } from "./server.mjs";

const require = createRequire(join(resolve(process.argv[2]), "package.json"));
const {
  Client,
  StreamableHTTPClientTransport,
} = require("@modelcontextprotocol/client");
const { McpServer, createMcpHandler } = require("@modelcontextprotocol/server");
const { z } = require("zod/v4");
let calls = 0;
const handler = createMcpHandler(
  () =>
    createServer(McpServer, z, () => {
      calls += 1;
    }),
  { legacy: "reject" },
);
const requests = [];
const transport = new StreamableHTTPClientTransport(
  new URL("https://fixture.invalid/mcp"),
  {
    fetch: (url, init) => {
      const request = new Request(url, init);
      requests.push(request.url);
      return handler.fetch(request);
    },
  },
);
const client = new Client(
  { name: "library-fixture-client", version: "1.0.0" },
  { versionNegotiation: { mode: "auto" } },
);
const checks = [];
try {
  await client.connect(transport);
  assert.equal(client.getProtocolEra(), "modern");
  assert.equal(client.getNegotiatedProtocolVersion(), "2026-07-28");
  checks.push(
    "v2 discovery negotiates the modern protocol with legacy rejected",
  );
  const listed = await client.listTools();
  assert.equal(listed.tools.length, 1);
  assert.equal(listed.tools[0].name, "read-item");
  assert.equal(listed.tools[0].inputSchema.additionalProperties, false);
  assert.equal(listed.tools[0].annotations.readOnlyHint, true);
  checks.push("Standard Schema advertises strict inputs and a read-only hint");
  const item = await client.callTool({
    name: "read-item",
    arguments: { itemId: "42" },
  });
  assert.deepEqual(item.structuredContent, {
    itemId: "42",
    title: "Fixture item",
  });
  assert.notEqual(item.isError, true);
  checks.push("modern tool call returns validated structured output");
  const invalidCases = [
    [{}, "missing required argument rejected before dispatch"],
    [{ itemId: 42 }, "wrong argument type rejected before dispatch"],
    [
      { itemId: "42", extra: true },
      "unknown argument rejected before dispatch",
    ],
  ];
  for (const [argumentsValue, name] of invalidCases) {
    const invalid = await client.callTool({
      name: "read-item",
      arguments: argumentsValue,
    });
    assert.equal(invalid.isError, true);
    assert.equal(calls, 1);
    checks.push(name);
  }
  const missing = await client.callTool({
    name: "read-item",
    arguments: { itemId: "missing" },
  });
  assert.equal(missing.isError, true);
  assert.equal(calls, 2);
  checks.push("domain failure is returned as an error tool result");
  assert.ok(requests.length >= 7);
  assert.ok(requests.every((url) => url === "https://fixture.invalid/mcp"));
  checks.push(
    "every request goes through the injected in-process Fetch handler",
  );
} finally {
  try {
    await client.close();
  } finally {
    await handler.close();
  }
}
checks.push("client and handler teardown complete within the process bound");
console.log(JSON.stringify({ checks }));
