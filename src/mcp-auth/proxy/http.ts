import { McpAuthError, request, responseObject } from "../_shared.js";
import { accessToken } from "../session.js";
import { rpcMessage } from "./_shared.js";
import { eventMessages } from "./events.js";
import type { ProxyOptions, RpcMessage } from "./types.js";

export class HttpConnection {
  private sessionId?: string;
  private protocolVersion?: string;
  private readonly abort = new AbortController();
  private events?: Promise<void>;

  constructor(
    private readonly options: ProxyOptions,
    private readonly emit: (message: RpcMessage) => void,
  ) {}

  private async send(method: string, body?: RpcMessage): Promise<Response> {
    const { name, server, env } = this.options;
    const serverUrl = server.url!;
    let token = await accessToken(name, serverUrl, env);
    const headers = new Headers(server.headers);
    for (const [header, variable] of Object.entries(server.headerEnv ?? {})) {
      const value = env[variable];
      if (!value)
        throw new McpAuthError(
          "A declared MCP header environment variable is missing",
        );
      headers.set(header, value);
    }
    headers.set("Accept", "application/json, text/event-stream");
    if (body) headers.set("Content-Type", "application/json");
    if (this.sessionId) headers.set("Mcp-Session-Id", this.sessionId);
    if (this.protocolVersion)
      headers.set("MCP-Protocol-Version", this.protocolVersion);
    const send = () => {
      if (token) headers.set("Authorization", `Bearer ${token}`);
      const signal = AbortSignal.any([
        this.abort.signal,
        AbortSignal.timeout(120_000),
      ]);
      return request(serverUrl, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal,
      });
    };
    let response = await send();
    if (response.status === 401 && token) {
      await response.body?.cancel();
      token = await accessToken(name, serverUrl, env, token);
      response = await send();
    }
    if (response.status === 401 || response.status === 403) {
      await response.body?.cancel();
      throw new McpAuthError(
        `MCP authentication required, expired, or revoked; run pmcp mcp login ${name}`,
      );
    }
    return response;
  }

  async post(message: RpcMessage): Promise<void> {
    const response = await this.send("POST", message);
    if (!response.ok) {
      await response.body?.cancel();
      throw new McpAuthError(
        `Remote MCP request failed (HTTP ${response.status})`,
      );
    }
    const sessionId = response.headers.get("mcp-session-id");
    if (sessionId) this.sessionId = sessionId;
    if (response.status === 202 || response.status === 204) {
      await response.body?.cancel();
      return;
    }
    const accept = (reply: RpcMessage) => {
      if (
        message.method === "initialize" &&
        reply.result &&
        typeof reply.result.protocolVersion === "string"
      )
        this.protocolVersion = reply.result.protocolVersion;
      this.emit(reply);
    };
    if (response.headers.get("content-type")?.includes("text/event-stream")) {
      for await (const reply of eventMessages(response)) {
        accept(reply);
        if (
          message.id !== undefined &&
          reply.id === message.id &&
          (reply.result !== undefined || reply.error !== undefined)
        )
          break;
      }
      return;
    }
    accept(rpcMessage(await responseObject(response)));
  }

  startEvents(): void {
    if (this.events || !this.sessionId) return;
    this.events = this.receiveEvents().catch(() => undefined);
  }

  private async receiveEvents(): Promise<void> {
    const response = await this.send("GET");
    if (
      !response.ok ||
      !response.headers.get("content-type")?.includes("text/event-stream")
    ) {
      await response.body?.cancel();
      return;
    }
    for await (const message of eventMessages(response)) this.emit(message);
  }

  async close(): Promise<void> {
    this.abort.abort();
    await this.events;
  }
}
