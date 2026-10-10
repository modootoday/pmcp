import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { createServer } from "./server.mjs";

const require = createRequire(join(resolve(process.argv[2]), "package.json"));
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { InMemoryTransport } = require("@modelcontextprotocol/sdk/inMemory.js");
const { z } = require("zod/v3");
let calls = 0;
const server = createServer(McpServer, z, () => {
  calls += 1;
});
const client = new Client({ name: "library-fixture-client", version: "1.0.0" });
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
const checks = [];
try {
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  assert.equal(client.getServerVersion().name, "library-fixture");
  checks.push("v1 client and server initialize over paired memory transport");
  const listed = await client.listTools();
  assert.equal(listed.tools.length, 1);
  assert.equal(listed.tools[0].name, "read-item");
  assert.equal(listed.tools[0].inputSchema.additionalProperties, false);
  assert.equal(listed.tools[0].annotations.readOnlyHint, true);
  checks.push("tool advertisement preserves strict input and read-only hint");
  const item = await client.callTool({
    name: "read-item",
    arguments: { itemId: "42" },
  });
  assert.deepEqual(item.structuredContent, {
    itemId: "42",
    title: "Fixture item",
  });
  assert.notEqual(item.isError, true);
  checks.push("valid call returns structured output through the real SDK");
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
} finally {
  try {
    await client.close();
  } finally {
    await server.close();
  }
}
const message = { jsonrpc: "2.0", method: "notifications/fixture" };
await assert.rejects(clientTransport.send(message));
await assert.rejects(serverTransport.send(message));
checks.push("both memory transport endpoints reject sends after cleanup");
console.log(JSON.stringify({ checks }));
