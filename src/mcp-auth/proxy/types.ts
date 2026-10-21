import type { McpServerSpec } from "../../project/spec.js";
import type { Environment } from "../types.js";

export interface RpcMessage {
  jsonrpc: "2.0";
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: unknown;
}

export interface ProxyOptions {
  name: string;
  server: McpServerSpec;
  env: Environment;
}
