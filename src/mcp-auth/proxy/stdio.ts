import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import { HttpConnection } from "./http.js";
import { rpcError, rpcMessage } from "./_shared.js";
import type { ProxyOptions, RpcMessage } from "./types.js";

export async function runProxy(
  options: ProxyOptions,
  input: Readable = process.stdin,
  output: Writable = process.stdout,
): Promise<number> {
  const emit = (message: RpcMessage) => {
    output.write(JSON.stringify(message) + "\n");
  };
  const connection = new HttpConnection(options, emit);
  const lines = createInterface({ input, crlfDelay: Infinity });
  const pending = new Set<Promise<void>>();
  let handshake = Promise.resolve();
  let failed = false;
  const stop = () => {
    lines.close();
    void connection.close();
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    for await (const line of lines) {
      if (!line.trim()) continue;
      let message: RpcMessage;
      try {
        message = rpcMessage(JSON.parse(line));
      } catch {
        emit({
          jsonrpc: "2.0",
          id: null,
          error: { code: -32700, message: "Invalid MCP JSON-RPC input" },
        });
        continue;
      }
      const work = handshake.then(async () => {
        try {
          await connection.post(message);
          if (message.method === "notifications/initialized")
            connection.startEvents();
        } catch (error) {
          failed = true;
          if (message.id !== undefined) emit(rpcError(message, error));
        }
      });
      pending.add(work);
      void work.finally(() => pending.delete(work));
      if (
        message.method === "initialize" ||
        message.method === "notifications/initialized"
      )
        handshake = work;
    }
    await Promise.all(pending);
    return failed ? 1 : 0;
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
    lines.close();
    await connection.close();
  }
}
