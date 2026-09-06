import { describe, expect, it } from "vitest";

import type { SkillEntry } from "../src/catalog.js";
import { cosine, find, lexicalScore } from "../src/find.js";

const entry = (name: string, description: string): SkillEntry => ({
  name,
  package: name.split("/").slice(0, 2).join("/"),
  slug: name.split("/").at(-1)!,
  description,
  path: `/tmp/${name}/SKILL.md`,
});

const entries = [
  entry("@acme/runner/adoption", "Wire the stage runner into a repository"),
  entry("@acme/parser/adoption", "Tokenize shell scripts and rewrite commands"),
  entry("@acme/clock/adoption", "Deterministic time and fake timers for tests"),
];

describe("lexicalScore", () => {
  it("scores an exact phrase above an unrelated one", () => {
    const near = lexicalScore("wire the stage runner", entries[0]!.description);
    const far = lexicalScore("wire the stage runner", entries[2]!.description);
    expect(near).toBeGreaterThan(far);
  });

  it("is zero for an empty intent", () => {
    expect(lexicalScore("", "anything at all")).toBe(0);
  });

  it("ignores case and punctuation", () => {
    expect(lexicalScore("Fake Timers!", entries[2]!.description)).toBe(
      lexicalScore("fake timers", entries[2]!.description),
    );
  });

  it("never exceeds one", () => {
    expect(lexicalScore("fake timers", "fake timers")).toBeLessThanOrEqual(1);
  });
});

describe("cosine", () => {
  it("is one for a vector against itself", () => {
    const v = new Float32Array([1, 2, 3]);
    expect(cosine(v, v)).toBeCloseTo(1, 6);
  });

  it("is zero for orthogonal vectors", () => {
    expect(cosine(new Float32Array([1, 0]), new Float32Array([0, 1]))).toBeCloseTo(0, 6);
  });

  it("is zero rather than NaN for a zero vector", () => {
    expect(cosine(new Float32Array([0, 0]), new Float32Array([1, 1]))).toBe(0);
  });

  it("is zero for mismatched widths rather than reading past the end", () => {
    expect(cosine(new Float32Array([1, 2]), new Float32Array([1, 2, 3]))).toBe(0);
  });
});

describe("find", () => {
  it("falls back to lexical with no embedder, and says so", async () => {
    const result = await find({ entries, intent: "stage runner" });
    expect(result.ranking).toBe("lexical");
    expect(result.matches[0]?.name).toBe("@acme/runner/adoption");
  });

  it("drops entries that match nothing rather than padding the list", async () => {
    const result = await find({ entries, intent: "stage runner" });
    expect(result.matches.length).toBeLessThan(entries.length);
  });

  it("returns nothing for an intent that matches nothing", async () => {
    const result = await find({ entries, intent: "zzzz" });
    expect(result.matches).toEqual([]);
  });

  it("honours the limit", async () => {
    const result = await find({ entries, intent: "wire tests time", limit: 1 });
    expect(result.matches).toHaveLength(1);
  });

  const embedder = {
    modelId: "test",
    dims: 3,
    embed: async (text: string) =>
      new Float32Array(text.includes("runner") ? [1, 0, 0] : [0, 1, 0]),
  };
  const vectors = new Map([
    ["@acme/runner/adoption", new Float32Array([1, 0, 0])],
    ["@acme/parser/adoption", new Float32Array([0, 1, 0])],
    ["@acme/clock/adoption", new Float32Array([0, 0, 1])],
  ]);

  it("ranks semantically when an embedder and a full index are supplied", async () => {
    const result = await find({ entries, intent: "runner", embedder, vectors });
    expect(result.ranking).toBe("semantic");
    expect(result.matches[0]?.name).toBe("@acme/runner/adoption");
  });

  // A partial semantic answer silently omits whatever the index missed, which
  // is worse than an honest lexical one over everything.
  it("falls back to lexical when the index does not cover every entry", async () => {
    const partial = new Map([["@acme/runner/adoption", new Float32Array([1, 0, 0])]]);
    const result = await find({ entries, intent: "runner", embedder, vectors: partial });
    expect(result.ranking).toBe("lexical");
  });

  it("falls back to lexical when there is an index but no embedder", async () => {
    const result = await find({ entries, intent: "runner", vectors });
    expect(result.ranking).toBe("lexical");
  });

  it("reads the query vector from the cache rather than embedding again", async () => {
    let embedCalls = 0;
    const counting = {
      ...embedder,
      embed: async (text: string) => {
        embedCalls += 1;
        return embedder.embed(text);
      },
    };
    const stored = new Map<string, Float32Array>();
    const cache = {
      get: (intent: string) => stored.get(intent) ?? null,
      put: (intent: string, vector: Float32Array) => void stored.set(intent, vector),
      stats: () => ({ hits: 0, misses: 0, mismatched: 0, rows: stored.size }),
      close: () => {},
    };

    await find({ entries, intent: "runner", embedder: counting, vectors, cache });
    await find({ entries, intent: "runner", embedder: counting, vectors, cache });
    expect(embedCalls).toBe(1);
  });
});
