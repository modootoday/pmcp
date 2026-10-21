// Keep endpoint validation independent so the projector cannot import a network client.
export class McpAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "McpAuthError";
  }
}

export function safeEndpoint(value: string): URL {
  const url = new URL(value);
  const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if (
    (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) ||
    url.username ||
    url.password ||
    url.hash
  ) {
    throw new McpAuthError(
      "MCP authentication requires HTTPS or loopback HTTP without embedded credentials",
    );
  }
  return url;
}
