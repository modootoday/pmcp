import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const installed = process.argv[2];
const entry = (name) => pathToFileURL(join(installed, "dist", name)).href;
const { openIntentCache } = await import(entry("index.js"));
const http = await import(entry("http.js"));
for (const name of [
  "createSkillHttpHandler",
  "readCatalog",
  "verifiedRuntimesOf",
  "visibleTo",
]) {
  assert.equal(typeof http[name], "function", name);
}
assert.deepEqual(http.readCatalog({ roots: [] }), []);
assert.deepEqual(
  http.verifiedRuntimesOf({
    "verified-runtimes": "grok-cli,codex-cli unknown grok-cli",
  }),
  ["grok-cli", "codex-cli"],
);
const handler = http.createSkillHttpHandler({
  roots: [],
  authorize: () => undefined,
});
assert.equal(await handler.ready(), "lexical");
assert.equal(
  (await handler.fetch(new Request("http://localhost/mcp"))).status,
  401,
);
const cache = await openIntentCache({
  path: ":memory:",
  modelId: "fixture",
  dims: 2,
});
assert.ok(cache, "SQLite unavailable");
try {
  const query = "변경 사항 검토";
  cache.put(query.normalize("NFD"), new Float32Array([1, 2]));
  assert.equal(cache.get(query)?.[1], 2);
  console.log(
    JSON.stringify({
      sqliteProvider: cache.stats().provider,
      httpEntry: "catalog-runtime-handler",
      unicodeCache: "NFC-NFD-equivalent",
    }),
  );
} finally {
  cache.close();
}
