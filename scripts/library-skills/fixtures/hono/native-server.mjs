import assert from "node:assert/strict";
import { once } from "node:events";

export async function verifyNativeServer(app, serve) {
  const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 });
  try {
    if (!server.listening)
      await once(server, "listening", { signal: AbortSignal.timeout(5000) });
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const response = await fetch(`http://127.0.0.1:${address.port}/items`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "network" }),
      signal: AbortSignal.timeout(5000),
    });
    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), { title: "network" });
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) return reject(error);
        resolve();
      });
    });
  }
  assert.equal(server.listening, false);
  return 4;
}
