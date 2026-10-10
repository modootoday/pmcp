/**
 * Checks a hosted skills server makes before a request reaches MCP: which browser origins
 * and Host names may call it, how large a request may be, and how often one caller may call.
 * Requests without an Origin header are not from a browser page and are not origin-checked.
 */

export const DEFAULT_MAX_REQUEST_BYTES = 1024 * 1024;

const RATE_WINDOW_MS = 60_000;

const CORS_ALLOW_HEADERS =
  "authorization, content-type, accept, mcp-session-id, mcp-protocol-version, last-event-id";

const json = (
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

export type OriginVerdict =
  | { readonly kind: "none" }
  | { readonly kind: "same" }
  | { readonly kind: "allowed"; readonly origin: string }
  | { readonly kind: "refused"; readonly response: Response };

/**
 * A page on another origin may call only when listed; DNS rebinding then fails here too.
 * Behind a proxy that ends TLS the request URL is not the public one, so publicOrigins names it.
 * "*" in allowedOrigins admits any origin; auth is a bearer header, never a cookie.
 */
export function checkOrigin(
  request: Request,
  allowedOrigins: readonly string[] = [],
  publicOrigins: readonly string[] = [],
): OriginVerdict {
  const origin = request.headers.get("origin");
  if (origin === null) return { kind: "none" };
  if (
    origin === new URL(request.url).origin ||
    publicOrigins.includes(origin)
  ) {
    return { kind: "same" };
  }
  if (allowedOrigins.includes(origin) || allowedOrigins.includes("*")) {
    return { kind: "allowed", origin };
  }
  return {
    kind: "refused",
    response: json(403, { error: "origin_not_allowed" }),
  };
}

/** When the host names its public Host values, any other Host is refused. */
export function checkHost(
  request: Request,
  allowedHosts: readonly string[] | undefined,
): Response | undefined {
  if (!allowedHosts) return undefined;
  const host = request.headers.get("host") ?? new URL(request.url).host;
  return allowedHosts.includes(host)
    ? undefined
    : json(403, { error: "host_not_allowed" });
}

export function corsHeaders(origin: string): Record<string, string> {
  return {
    "access-control-allow-origin": origin,
    "access-control-expose-headers": "mcp-session-id, www-authenticate",
    vary: "Origin",
  };
}

export function preflight(origin: string): Response {
  return new Response(null, {
    status: 204,
    headers: {
      ...corsHeaders(origin),
      "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
      "access-control-allow-headers": CORS_ALLOW_HEADERS,
      "access-control-max-age": "600",
    },
  });
}

export function withHeaders(
  response: Response,
  headers: Record<string, string>,
): Response {
  const merged = new Headers(response.headers);
  for (const [name, value] of Object.entries(headers)) merged.set(name, value);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: merged,
  });
}

const tooLarge = (max: number): Response =>
  json(413, { error: "request_too_large", limit: max });

/**
 * The request with its body read under the cap, or a 413. A declared length over the cap
 * is refused before reading; an undeclared one is read only until it passes the cap.
 */
export async function capBody(
  request: Request,
  max: number,
): Promise<Request | Response> {
  const declared = Number(request.headers.get("content-length") ?? NaN);
  if (Number.isFinite(declared) && declared > max) return tooLarge(max);
  if (!request.body) return request;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      return tooLarge(max);
    }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new Request(request.url, {
    method: request.method,
    headers: request.headers,
    body,
  });
}

export interface RateLimitOptions {
  /** Requests one caller may make in a minute. */
  readonly perMinute: number;
  /** Injected by tests. */
  readonly now?: () => number;
}

/** A fixed one-minute window per caller id; a 429 names when the window ends. */
export function createRateLimiter(
  options: RateLimitOptions,
): (callerId: string) => Response | undefined {
  const now = options.now ?? Date.now;
  const windows = new Map<string, { start: number; count: number }>();
  return (callerId) => {
    const t = now();
    const window = windows.get(callerId);
    if (!window || t - window.start >= RATE_WINDOW_MS) {
      windows.set(callerId, { start: t, count: 1 });
      return undefined;
    }
    window.count += 1;
    if (window.count <= options.perMinute) return undefined;
    const retry = Math.ceil((window.start + RATE_WINDOW_MS - t) / 1000);
    return json(
      429,
      { error: "rate_limited" },
      { "retry-after": String(Math.max(retry, 1)) },
    );
  };
}
