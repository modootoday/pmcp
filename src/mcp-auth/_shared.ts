import { McpAuthError, safeEndpoint } from "./endpoint.js";

export { McpAuthError, safeEndpoint } from "./endpoint.js";

export async function request(
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  safeEndpoint(url);
  try {
    return await fetch(url, {
      ...init,
      redirect: "error",
      signal: init.signal ?? AbortSignal.timeout(30_000),
    });
  } catch {
    throw new McpAuthError(
      "MCP endpoint request failed; remote details are redacted",
    );
  }
}

export async function responseObject(
  response: Response,
): Promise<Record<string, unknown>> {
  try {
    const text = await response.text();
    if (text.length > 1024 * 1024) throw new Error("size");
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("shape");
    return value as Record<string, unknown>;
  } catch {
    throw new McpAuthError(
      "MCP endpoint returned an invalid document; contents are redacted",
    );
  }
}
