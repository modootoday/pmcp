import { describe, expect, it } from "vitest";

import type { SkillEntry } from "../src/catalog.js";
import type { Embedder } from "../src/find.js";
import { createSkillHttpHandler } from "../src/http.js";

const entry = (slug: string, description: string): SkillEntry => ({
  name: `mp/plugin/${slug}`,
  package: "mp/plugin",
  slug,
  description,
  path: `/nowhere/${slug}/SKILL.md`,
  tier: "open",
});

const ENTRIES = [
  entry("subtitle-timing", "Time subtitles to a narration voice track"),
  entry("launch-email", "Write a product launch email"),
];

// Two concepts, recognised in either language, stand in for a multilingual model.
const concept = (text: string) =>
  /subtitle|字幕/.test(text) ? Float32Array.of(1, 0) : Float32Array.of(0, 1);
const bilingual: Embedder = {
  modelId: "fake-multilingual",
  dims: 2,
  embed: async (text) => concept(text),
  embedPassage: async (text) => concept(text),
};

function handler(
  semantic?: Parameters<typeof createSkillHttpHandler>[0]["semantic"],
) {
  return createSkillHttpHandler({
    roots: [],
    loadCatalog: () => ENTRIES,
    authorize: () => ({ id: "user-1" }),
    ...(semantic ? { semantic } : {}),
  });
}

async function find(h: ReturnType<typeof handler>, intent: string) {
  const response = await h.fetch(
    new Request("http://localhost/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": "2025-06-18",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "skill_find", arguments: { intent } },
      }),
    }),
  );
  const text = await response.text();
  const data = text.startsWith("{")
    ? text
    : (text
        .split("\n")
        .find((l) => l.startsWith("data:"))
        ?.slice(5) ?? "{}");
  return JSON.parse(JSON.parse(data).result.content[0].text) as {
    ranking: string;
    matches: { name: string }[];
  };
}

describe("createSkillHttpHandler with semantic ranking", () => {
  it("finds an English description from a Japanese intent once encoded", async () => {
    const h = handler({ embedder: bilingual });
    expect(await h.ready()).toBe("semantic");
    const result = await find(h, "ナレーションに合わせて字幕を分ける");
    expect(result.ranking).toBe("semantic");
    expect(result.matches[0]?.name).toBe("mp/plugin/subtitle-timing");
  });

  it("stays lexical and reports why when the encoder cannot load", async () => {
    const errors: unknown[] = [];
    const failing: Embedder = {
      ...bilingual,
      embedPassage: async () => {
        throw new Error("model files missing");
      },
    };
    const h = handler({ embedder: failing, onError: (e) => errors.push(e) });
    expect(await h.ready()).toBe("lexical");
    expect(errors).toHaveLength(1);
    expect((await find(h, "launch email")).ranking).toBe("lexical");
  });

  it("is lexical without the option", async () => {
    const h = handler();
    expect(await h.ready()).toBe("lexical");
    expect((await find(h, "launch email")).ranking).toBe("lexical");
  });
});
