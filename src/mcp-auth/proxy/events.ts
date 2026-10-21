import { McpAuthError } from "../_shared.js";
import { rpcMessage } from "./_shared.js";
import type { RpcMessage } from "./types.js";

export async function* eventMessages(
  response: Response,
): AsyncGenerator<RpcMessage> {
  if (!response.body) return;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let data: string[] = [];
  let dataBytes = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      buffer += decoder.decode(chunk.value, { stream: !chunk.done });
      if (buffer.length > 16 * 1024 * 1024)
        throw new McpAuthError("MCP event exceeds the proxy message limit");
      let end: number;
      while ((end = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, end).replace(/\r$/u, "");
        buffer = buffer.slice(end + 1);
        if (line === "") {
          if (data.length) yield rpcMessage(JSON.parse(data.join("\n")));
          data = [];
          dataBytes = 0;
          continue;
        }
        if (line.startsWith("data:")) {
          dataBytes += line.length;
          if (dataBytes > 16 * 1024 * 1024)
            throw new McpAuthError("MCP event exceeds the proxy message limit");
          data.push(line.slice(5).replace(/^ /u, ""));
        }
      }
      if (chunk.done) break;
    }
    if (data.length) yield rpcMessage(JSON.parse(data.join("\n")));
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
