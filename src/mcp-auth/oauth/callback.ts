import { createServer } from "node:http";
import { McpAuthError } from "../_shared.js";
import type { PendingLogin } from "../types.js";
import { authorizationCode } from "./login.js";

export async function callbackListener(port = 0) {
  let active: PendingLogin | undefined;
  let finish: ((value: string) => void) | undefined;
  let fail: ((error: Error) => void) | undefined;
  const server = createServer((req, res) => {
    if (!active || req.method !== "GET" || !req.url?.startsWith("/callback?")) {
      res.writeHead(404).end();
      return;
    }
    const url = new URL(req.url, active.redirectUri).toString();
    try {
      authorizationCode(url, active);
      res
        .writeHead(200, {
          "Content-Type": "text/plain",
          "Cache-Control": "no-store",
        })
        .end("MCP authorization received. You may close this window.");
      finish?.(url);
    } catch {
      res
        .writeHead(400, { "Content-Type": "text/plain" })
        .end("Invalid OAuth callback");
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", () =>
      reject(new McpAuthError("Cannot listen for the loopback OAuth callback")),
    );
    server.listen(port, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new McpAuthError("No OAuth callback address");
  let timer: NodeJS.Timeout | undefined;
  return {
    redirectUri: `http://127.0.0.1:${address.port}/callback`,
    wait(pending: PendingLogin): Promise<string> {
      active = pending;
      return new Promise((resolve, reject) => {
        finish = resolve;
        fail = reject;
        timer = setTimeout(
          () =>
            reject(new McpAuthError("OAuth login timed out; restart login")),
          Math.max(1, pending.expiresAt - Date.now()),
        );
      });
    },
    close() {
      clearTimeout(timer);
      fail?.(new McpAuthError("OAuth callback listener closed"));
      server.close();
    },
  };
}
