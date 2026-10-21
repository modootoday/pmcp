import type { IncomingMessage, ServerResponse } from "node:http";
import { body, send } from "./_shared.js";
import type { FakeState } from "./types.js";

export async function mcpRoute(
  req: IncomingMessage,
  res: ServerResponse,
  state: FakeState,
): Promise<void> {
  if (
    !state.accessToken ||
    req.headers.authorization !== `Bearer ${state.accessToken}` ||
    state.revoked
  ) {
    res.setHeader(
      "WWW-Authenticate",
      `Bearer resource_metadata="${new URL(state.resource).origin}/.well-known/oauth-protected-resource/mcp"`,
    );
    send(res, 401, {});
    return;
  }
  if (state.forbid) {
    send(res, 403, { secret: state.accessToken });
    return;
  }
  if (state.fail) {
    send(res, 500, { secret: state.accessToken });
    return;
  }
  if (req.method === "GET") {
    send(res, 405, {});
    return;
  }
  const message = JSON.parse(await body(req));
  if (message.method === "initialize") {
    const id = `session-${state.sessions.size}`;
    state.sessions.add(id);
    res.setHeader("Mcp-Session-Id", id);
    send(res, 200, {
      jsonrpc: "2.0",
      id: message.id,
      result: {
        protocolVersion: "2025-11-25",
        capabilities: { tools: {} },
        serverInfo: { name: "fake", version: "1.0.0" },
      },
    });
    return;
  }
  if (
    !state.sessions.has(String(req.headers["mcp-session-id"])) ||
    req.headers["mcp-protocol-version"] !== "2025-11-25"
  ) {
    send(res, 400, {});
    return;
  }
  if (message.id === undefined) {
    res.writeHead(202).end();
    return;
  }
  state.calls++;
  const reply = {
    jsonrpc: "2.0",
    id: message.id,
    result: { content: [{ type: "text", text: "fake-result" }] },
  };
  if (state.sse) {
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write(
      'data: {"jsonrpc":"2.0","method":"notifications/message","params":{"level":"info","data":"progress"}}\r\n\r\n',
    );
    res.end(`data: ${JSON.stringify(reply)}\r\n\r\n`);
    return;
  }
  send(res, 200, reply);
}
