import { describe, expect, it } from "vitest";

import type { SkillEntry } from "../src/catalog.js";
import { createSkillHttpHandler, visibleTo } from "../src/http.js";

const entry = (name: string, tier?: string): SkillEntry => ({
  name,
  package: name.split("/").slice(0, -1).join("/"),
  slug: name.split("/").at(-1)!,
  description: `Does ${name}. Use when testing.`,
  path: `/nowhere/${name}/SKILL.md`,
  ...(tier ? { tier } : {}),
});

const ENTRIES = [
  entry("mp/open-plugin/open-skill", "open"),
  entry("mp/free-plugin/free-skill", "free"),
  entry("mp/paid-plugin/paid-skill", "paid"),
  entry("@scope/pkg/package-skill"),
];

const BEARER = "Bearer good";

function handler() {
  return createSkillHttpHandler({
    roots: [],
    loadCatalog: () => ENTRIES,
    authorize: (request) =>
      request.headers.get("authorization") === BEARER
        ? { id: "user-1" }
        : undefined,
  });
}

async function rpc(
  h: ReturnType<typeof handler>,
  method: string,
  params: Record<string, unknown>,
  auth = true,
) {
  const response = await h.fetch(
    new Request("http://localhost/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": "2025-06-18",
        ...(auth ? { authorization: BEARER } : {}),
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    }),
  );
  const text = await response.text();
  const data = text.startsWith("{")
    ? text
    : (text
        .split("\n")
        .find((l) => l.startsWith("data:"))
        ?.slice(5) ?? "{}");
  return {
    status: response.status,
    body: JSON.parse(data) as Record<string, any>,
  };
}

describe("visibleTo", () => {
  it("keeps only granted tiers and treats untiered package skills as open", () => {
    expect(visibleTo(ENTRIES, ["open"]).map((e) => e.slug)).toEqual([
      "open-skill",
      "package-skill",
    ]);
  });
});

describe("createSkillHttpHandler", () => {
  it("refuses an anonymous request with 401 and a challenge", async () => {
    const response = await handler().fetch(
      new Request("http://localhost/mcp", { method: "POST", body: "{}" }),
    );
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe("Bearer");
  });

  it("lists open and free skills to a signed-in caller, never paid", async () => {
    const { status, body } = await rpc(handler(), "tools/call", {
      name: "skill_catalog",
      arguments: {},
    });
    expect(status).toBe(200);
    const text = JSON.stringify(body);
    expect(text).toContain("open-skill");
    expect(text).toContain("free-skill");
    expect(text).not.toContain("paid-skill");
  });

  it("grants what tiersFor returns", async () => {
    const h = createSkillHttpHandler({
      roots: [],
      loadCatalog: () => ENTRIES,
      authorize: () => ({ id: "anyone" }),
      tiersFor: () => ["open"],
    });
    const { body } = await rpc(h, "tools/call", {
      name: "skill_catalog",
      arguments: {},
    });
    expect(JSON.stringify(body)).toContain("open-skill");
    expect(JSON.stringify(body)).not.toContain("free-skill");
  });
});
