import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join } from "node:path";

const [scratchRoot, directory] = process.argv.slice(2);
if (!scratchRoot || !directory)
  throw new Error("Pass dependency and fixture workspace paths");
const require = createRequire(join(scratchRoot, "package.json"));
const { unstable_dev } = require("wrangler");
const worker = await unstable_dev(join(directory, "worker.js"), {
  config: join(directory, "wrangler.json"),
  ip: "127.0.0.1",
  port: 0,
  inspectorPort: 0,
  local: true,
  persist: false,
  logLevel: "none",
  experimental: {
    disableExperimentalWarning: true,
    disableDevRegistry: true,
    forceLocal: true,
  },
});
try {
  const missing = await worker.fetch("/");
  assert.equal(missing.status, 404);
  const rejected = await worker.fetch("/", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: 42 }),
  });
  assert.equal(rejected.status, 400);
  const saved = await worker.fetch("/", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: "local" }),
  });
  assert.equal(saved.status, 201);
  assert.deepEqual(await saved.json(), { saved: "local", mode: "fixture" });
  const found = await worker.fetch("/");
  assert.equal(found.status, 200);
  assert.deepEqual(await found.json(), { title: "local", mode: "fixture" });
} finally {
  await worker.stop();
}
console.log(
  JSON.stringify({
    checks: [
      "local missing KV response",
      "invalid payload rejected before KV write",
      "local KV write and generated variable",
      "local KV read through Worker handler",
      "local runner stopped",
    ],
  }),
);
