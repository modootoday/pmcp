import { describe, expect, it } from "vitest";

import type { SkillEntry } from "../src/catalog.js";
import { createSkillHttpHandler, type SkillHttpOptions } from "../src/http.js";

const ENTRIES: SkillEntry[] = [
  {
    name: "mp/kit/one",
    package: "mp/kit",
    slug: "one",
    description: "Does one thing. Use when testing.",
    path: "/nowhere/mp/kit/one/SKILL.md",
    tier: "open",
  },
];

const BEARER = "Bearer good";

const handler = (extra: Partial<SkillHttpOptions> = {}) =>
  createSkillHttpHandler({
    roots: [],
    loadCatalog: () => ENTRIES,
    authorize: (request) =>
      request.headers.get("authorization") === BEARER
        ? { id: "user-1" }
        : undefined,
    ...extra,
  });

const body = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "tools/list",
  params: {},
});

function post(headers: Record<string, string> = {}, payload = body): Request {
  return new Request("http://skills.test/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": "2025-06-18",
      authorization: BEARER,
      ...headers,
    },
    body: payload,
  });
}

describe("origin", () => {
  it("serves a request without Origin, which no browser page sends", async () => {
    expect((await handler().fetch(post())).status).toBe(200);
  });

  it("serves the server's own origin", async () => {
    const response = await handler().fetch(
      post({ origin: "http://skills.test" }),
    );
    expect(response.status).toBe(200);
  });

  it("refuses another origin by default, before authorization", async () => {
    const response = await handler().fetch(
      post({ origin: "https://evil.example", authorization: "" }),
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "origin_not_allowed" });
  });

  it("refuses its own public origin behind a TLS proxy unless publicOrigins names it", async () => {
    const proxied = post({ origin: "https://skills.test" });
    expect((await handler().fetch(proxied.clone())).status).toBe(403);
    const named = handler({ publicOrigins: ["https://skills.test"] });
    const response = await named.fetch(proxied);
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("admits any origin with CORS headers when allowedOrigins holds *", async () => {
    const h = handler({ allowedOrigins: ["*"] });
    const response = await h.fetch(
      post({ origin: "https://inspector.example" }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "https://inspector.example",
    );
  });

  it("serves a listed origin with CORS headers and answers its preflight", async () => {
    const h = handler({ allowedOrigins: ["https://app.example"] });
    const response = await h.fetch(post({ origin: "https://app.example" }));
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "https://app.example",
    );
    const pre = await h.fetch(
      new Request("http://skills.test/mcp", {
        method: "OPTIONS",
        headers: { origin: "https://app.example" },
      }),
    );
    expect(pre.status).toBe(204);
    expect(pre.headers.get("access-control-allow-headers")).toContain(
      "authorization",
    );
  });
});

describe("host", () => {
  it("answers any Host when none are listed", async () => {
    expect((await handler().fetch(post({ host: "other.test" }))).status).toBe(
      200,
    );
  });

  it("refuses a Host outside the list", async () => {
    const h = handler({ allowedHosts: ["skills.test"] });
    expect((await h.fetch(post({ host: "skills.test" }))).status).toBe(200);
    const refused = await h.fetch(post({ host: "rebound.test" }));
    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual({ error: "host_not_allowed" });
  });
});

describe("request size", () => {
  it("refuses a declared length over the cap without reading it", async () => {
    const h = handler({ maxRequestBytes: 64 });
    const response = await h.fetch(post({ "content-length": "1000" }));
    expect(response.status).toBe(413);
  });

  it("refuses an undeclared body once it passes the cap", async () => {
    const h = handler({ maxRequestBytes: 64 });
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("x".repeat(50)));
        controller.enqueue(new TextEncoder().encode("y".repeat(50)));
        controller.close();
      },
    });
    const request = new Request("http://skills.test/mcp", {
      method: "POST",
      headers: { authorization: BEARER, "content-type": "application/json" },
      body: stream,
      duplex: "half",
    } as RequestInit);
    expect((await h.fetch(request)).status).toBe(413);
  });

  it("refuses an unauthenticated caller before reading its body", async () => {
    const h = handler({ maxRequestBytes: 64 });
    const response = await h.fetch(
      post({ authorization: "", "content-length": "1000" }),
    );
    expect(response.status).toBe(401);
  });

  it("hands authorize the host's own Request, so callers keyed by it are found", async () => {
    const callers = new WeakMap<Request, { id: string }>();
    const h = createSkillHttpHandler({
      roots: [],
      loadCatalog: () => ENTRIES,
      authorize: (request) => callers.get(request),
    });
    const request = post();
    callers.set(request, { id: "user-1" });
    expect((await h.fetch(request)).status).toBe(200);
  });

  it("serves a body under the cap", async () => {
    expect(
      (await handler({ maxRequestBytes: 4096 }).fetch(post())).status,
    ).toBe(200);
  });
});

describe("rate limit", () => {
  it("is off unless asked for", async () => {
    const h = handler();
    for (let i = 0; i < 5; i += 1)
      expect((await h.fetch(post())).status).toBe(200);
  });

  it("refuses a caller past the ceiling until the minute ends", async () => {
    let t = 0;
    const h = handler({ rateLimit: { perMinute: 2, now: () => t } });
    expect((await h.fetch(post())).status).toBe(200);
    expect((await h.fetch(post())).status).toBe(200);
    const limited = await h.fetch(post());
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("60");
    t = 60_000;
    expect((await h.fetch(post())).status).toBe(200);
  });
});
