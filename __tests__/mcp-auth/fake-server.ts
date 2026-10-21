import { createServer } from "node:http";
import { oauthRoute } from "./fake-server/oauth.js";
import { mcpRoute } from "./fake-server/mcp.js";
import type { FakeState } from "./fake-server/types.js";

export async function fakeServer() {
  const state: FakeState = {
    issued: 0,
    refreshes: 0,
    calls: 0,
    revoked: false,
    forbid: false,
    pkce: true,
    sse: false,
    fail: false,
    resource: "",
    sessions: new Set(),
  };
  const server = createServer((req, res) => {
    void (async () => {
      if (await oauthRoute(req, res, state)) return;
      await mcpRoute(req, res, state);
    })().catch(() => res.writeHead(500).end());
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("No fake server address");
  state.resource = `http://127.0.0.1:${address.port}/mcp`;
  return {
    url: state.resource,
    state,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
