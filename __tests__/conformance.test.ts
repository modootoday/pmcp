import { describe, expect, it } from "vitest";

import { createSkillHttpHandler } from "../src/http.js";
import {
  bundleResponseSchema,
  catalogResponseSchema,
  describeResponseSchema,
  findResultSchema,
} from "../src/tools/schemas.js";
import { skillTree } from "./fixtures/skill-tree.js";

const { entries } = skillTree();
const KIT = "mp/plug/kit";

function handler(tiers: readonly string[] = ["open", "free"], prompts = false) {
  return createSkillHttpHandler({
    roots: [],
    loadCatalog: () => entries,
    authorize: () => ({ id: "user-1" }),
    tiersFor: () => tiers,
    prompts,
  });
}

async function rpc(
  h: ReturnType<typeof handler>,
  method: string,
  params: Record<string, unknown> = {},
) {
  const response = await h.fetch(
    new Request("http://localhost/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": "2025-06-18",
        authorization: "Bearer any",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    }),
  );
  const text = await response.text();
  const data = text.startsWith("{")
    ? text
    : (text
        .split("\n")
        .find((line) => line.startsWith("data:"))
        ?.slice(5) ?? "{}");
  return JSON.parse(data) as Record<string, any>;
}

const call = (h: ReturnType<typeof handler>, name: string, args: object) =>
  rpc(h, "tools/call", { name, arguments: args }).then((r) => r.result);

describe("tools", () => {
  it("lists six read-only tools with titles, and output schemas where results are structured", async () => {
    const { result } = await rpc(handler(), "tools/list");
    const byName = new Map(result.tools.map((t: any) => [t.name, t]));
    expect([...byName.keys()].sort()).toEqual([
      "skill_bundle",
      "skill_call",
      "skill_catalog",
      "skill_describe",
      "skill_find",
      "skill_read",
    ]);
    for (const tool of byName.values() as Iterable<any>) {
      expect(tool.annotations.title).toBe(tool.title);
      expect(tool.annotations.readOnlyHint).toBe(true);
    }
    for (const name of [
      "skill_catalog",
      "skill_find",
      "skill_describe",
      "skill_bundle",
    ])
      expect((byName.get(name) as any).outputSchema).toBeDefined();
  });

  it("returns structuredContent that its schema accepts, including an empty catalog", async () => {
    const h = handler();
    expect(
      catalogResponseSchema.safeParse(
        (await call(h, "skill_catalog", {})).structuredContent,
      ).success,
    ).toBe(true);
    expect(
      catalogResponseSchema.safeParse(
        (await call(handler([]), "skill_catalog", {})).structuredContent,
      ).success,
    ).toBe(true);
    expect(
      findResultSchema.safeParse(
        (await call(h, "skill_find", { intent: "build things" }))
          .structuredContent,
      ).success,
    ).toBe(true);
    expect(
      describeResponseSchema.safeParse(
        (await call(h, "skill_describe", { name: KIT })).structuredContent,
      ).success,
    ).toBe(true);
    expect(
      bundleResponseSchema.safeParse(
        (await call(h, "skill_bundle", { name: KIT })).structuredContent,
      ).success,
    ).toBe(true);
  });

  it("carries no structuredContent on an error result", async () => {
    for (const tool of ["skill_describe", "skill_bundle", "skill_call"]) {
      const result = await call(handler(), tool, { name: "mp/plug/none" });
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toBeUndefined();
    }
  });

  it("reads a folded description as its text", async () => {
    const result = await call(handler(), "skill_describe", { name: KIT });
    expect(result.structuredContent.frontmatter).toContain("description: >-");
    const listed = await call(handler(), "skill_catalog", {});
    expect(listed.structuredContent.packages[0].skills[0].description).toBe(
      "Builds things, in two lines.",
    );
  });

  it("returns images as image content and other binary as an embedded resource", async () => {
    const h = handler();
    const png = await call(h, "skill_read", {
      name: KIT,
      path: "assets/logo.png",
    });
    expect(png.content[1]).toMatchObject({
      type: "image",
      mimeType: "image/png",
    });
    const wasm = await call(h, "skill_read", {
      name: KIT,
      path: "assets/engine.wasm",
    });
    expect(wasm.content[1]).toMatchObject({
      type: "resource",
      resource: {
        mimeType: "application/wasm",
        uri: `skill://pmcp/${KIT}/assets/engine.wasm`,
      },
    });
  });

  it("follows a skill body with resource links to its other files", async () => {
    const result = await call(handler(), "skill_call", { name: KIT });
    const links = result.content.filter((c: any) => c.type === "resource_link");
    expect(links.map((l: any) => l.name)).toContain("scripts/run.py");
    expect(
      links.every((l: any) => l.uri.startsWith(`skill://pmcp/${KIT}/`)),
    ).toBe(true);
    expect(links.map((l: any) => l.name)).not.toContain("SKILL.md");
  });
});

describe("resources", () => {
  it("reads a linked file, binary as a typed blob", async () => {
    const { result } = await rpc(handler(), "resources/read", {
      uri: `skill://pmcp/${KIT}/assets/logo.png`,
    });
    expect(result.contents[0]).toMatchObject({ mimeType: "image/png" });
    expect(result.contents[0].blob).toBeTruthy();
  });

  it("refuses a paid skill's file to an open and free caller, and serves it to a paid one", async () => {
    const uri = "skill://pmcp/mp/plug/vault/references/secret.md";
    expect(
      (await rpc(handler(["open", "free"]), "resources/read", { uri })).error,
    ).toBeDefined();
    const paid = await rpc(handler(["open", "paid"]), "resources/read", {
      uri,
    });
    expect(paid.result.contents[0].text).toBe("classified\n");
  });

  it("lists only the skills the caller may see", async () => {
    const { result } = await rpc(handler(["open"]), "resources/list");
    expect(result.resources.map((r: any) => r.name)).toEqual([KIT]);
  });

  it("completes skill names and file paths for the template", async () => {
    const { result } = await rpc(handler(), "completion/complete", {
      ref: { type: "ref/resource", uri: "skill://pmcp/{+path}" },
      argument: { name: "path", value: `${KIT}/ref` },
    });
    expect(result.completion.values).toEqual([`${KIT}/references/guide.md`]);
  });
});

describe("Skills extension", () => {
  it("declares ttlMs and a private cache scope on skills/get behind authorization", async () => {
    const { result } = await rpc(handler(), "skills/get", {
      uri: `skill://pmcp/${KIT}/SKILL.md`,
    });
    expect(result).toMatchObject({
      resultType: "complete",
      ttlMs: 60_000,
      cacheScope: "private",
    });
    const list = await rpc(handler(), "skills/list");
    expect(list.result.cacheScope).toBe("private");
  });
});

describe("prompts", () => {
  it("offers one prompt per visible skill only when asked for", async () => {
    expect((await rpc(handler(), "prompts/list")).error).toBeDefined();
    const { result } = await rpc(handler(["open"], true), "prompts/list");
    expect(result.prompts.map((p: any) => p.name)).toEqual(["mp-plug-kit"]);
    const got = await rpc(handler(["open"], true), "prompts/get", {
      name: "mp-plug-kit",
      arguments: { task: "a shelf" },
    });
    expect(got.result.messages[0].content.text).toContain("Task: a shelf");
  });
});
