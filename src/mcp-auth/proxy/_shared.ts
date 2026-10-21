import { McpAuthError } from "../_shared.js";
import type { RpcMessage } from "./types.js";

export function rpcMessage(value: unknown): RpcMessage {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    (value as RpcMessage).jsonrpc !== "2.0"
  )
    throw new McpAuthError("Invalid MCP JSON-RPC message");
  return value as RpcMessage;
}

export function rpcError(input: RpcMessage, error: unknown): RpcMessage {
  const message =
    error instanceof McpAuthError
      ? error.message
      : "MCP proxy request failed; details are redacted";
  return { jsonrpc: "2.0", id: input.id, error: { code: -32001, message } };
}
