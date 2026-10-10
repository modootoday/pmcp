import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { DEFAULT_MODEL_ID, openEntryVectors } from "../src/embed.js";
import { resolveEncoder } from "../src/encoder.js";
import { openIntentCache } from "../src/cache.js";
import { find } from "../src/find.js";
import { prepareSearch } from "../src/search.js";

let directory: string;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "pmcp-search-"));
});
afterEach(() => rmSync(directory, { recursive: true, force: true }));
const entry = {
  name: "@acme/tools/git",
  package: "@acme/tools",
  slug: "git",
  description: "Review changes and commit",
  path: "/nowhere/SKILL.md",
};
const loadCatalog = () => [entry];
const embedder = {
  modelId: DEFAULT_MODEL_ID,
  dims: 2,
  embed: async () => Float32Array.of(1, 0),
};

it("keeps query caches separate across equal-width profiles and reuses them after restoration", async () => {
  const cache = (await openIntentCache({
    path: join(directory, "queries.sqlite"),
    modelId: DEFAULT_MODEL_ID,
    dims: 2,
  }))!;
  const database = {
    ...entry,
    name: "@acme/tools/database",
    slug: "database",
    description: "Design database tables",
  };
  let e5Calls = 0;
  let preciseCalls = 0;
  const first = {
    ...embedder,
    indexKey: resolveEncoder("e5-small").indexKey,
    embed: async () => {
      e5Calls += 1;
      return Float32Array.of(1, 0);
    },
  };
  const precise = {
    ...embedder,
    indexKey: resolveEncoder("e5-small", { dtype: "fp32" }).indexKey,
    embed: async () => {
      preciseCalls += 1;
      return Float32Array.of(0, 1);
    },
  };
  const e5Vectors = new Map([
    [entry.name, Float32Array.of(1, 0)],
    [database.name, Float32Array.of(0, 1)],
  ]);
  const preciseVectors = new Map([
    [entry.name, Float32Array.of(0, 1)],
    [database.name, Float32Array.of(1, 0)],
  ]);
  try {
    for (const [encoder, vectors] of [
      [first, e5Vectors],
      [precise, preciseVectors],
      [first, e5Vectors],
    ] as const) {
      const result = await find({
        entries: [entry, database],
        intent: "\uae43 \ucee4\ubc0b",
        embedder: encoder,
        vectors,
        cache,
      });
      expect(result.matches[0]?.name).toBe(entry.name);
    }
    expect(e5Calls).toBe(1);
    expect(preciseCalls).toBe(1);
    expect(cache.stats().rows).toBe(2);
    expect(cache.stats().hits).toBe(1);
  } finally {
    cache.close();
  }
});

it("falls back when direct API vectors have the wrong dimensions", async () => {
  expect(
    await find({
      entries: [entry],
      intent: "git commit",
      embedder,
      vectors: new Map([[entry.name, Float32Array.of(1, 0, 0)]]),
    }),
  ).toMatchObject({ ranking: "lexical" });
});

it("reports missing indexes and refuses stale descriptions or vector widths", async () => {
  const indexPath = join(directory, "index.sqlite");
  const options = { indexPath, embedder, loadCatalog };
  expect(await prepareSearch({ roots: [] }, options)).toMatchObject({
    ranking: "lexical",
    reason: "index_missing",
  });
  const store = (await openEntryVectors(indexPath))!;
  store.write(
    DEFAULT_MODEL_ID,
    entry.name,
    "old description",
    Float32Array.of(1, 0),
  );
  expect(await prepareSearch({ roots: [] }, options)).toMatchObject({
    ranking: "lexical",
    reason: "index_stale",
  });
  store.write(
    DEFAULT_MODEL_ID,
    entry.name,
    entry.description,
    Float32Array.of(1, 0, 0),
  );
  expect(await prepareSearch({ roots: [] }, options)).toMatchObject({
    ranking: "lexical",
    reason: "vector_mismatch",
  });
  store.close();
});

it("switches between same-width indexes without mixing them or writing during serve", async () => {
  const indexPath = join(directory, "index.sqlite");
  const store = (await openEntryVectors(indexPath))!;
  const full = resolveEncoder("e5-small", { dtype: "fp32" });
  store.write(
    DEFAULT_MODEL_ID,
    entry.name,
    entry.description,
    Float32Array.of(1, 0),
  );
  store.write(
    full.indexKey,
    entry.name,
    entry.description,
    Float32Array.of(0, 1),
  );
  store.close();
  const before = readFileSync(indexPath);
  const legacy = await prepareSearch(
    { roots: [] },
    { indexPath, embedder, loadCatalog },
  );
  expect(legacy.ranking).toBe("semantic");
  expect([...legacy.options.vectors!.get(entry.name)!]).toEqual([1, 0]);
  const precise = await prepareSearch(
    { roots: [] },
    {
      indexPath,
      dtype: "fp32",
      embedder: { ...embedder, indexKey: full.indexKey },
      loadCatalog,
    },
  );
  expect(precise.ranking).toBe("semantic");
  expect([...precise.options.vectors!.get(entry.name)!]).toEqual([0, 1]);
  const restored = await prepareSearch(
    { roots: [] },
    { indexPath, embedder, loadCatalog },
  );
  expect([...restored.options.vectors!.get(entry.name)!]).toEqual([1, 0]);
  expect(readFileSync(indexPath)).toEqual(before);
});

it("refuses an injected encoder with incompatible configuration identity", async () => {
  const indexPath = join(directory, "index.sqlite");
  const store = (await openEntryVectors(indexPath))!;
  store.write(
    DEFAULT_MODEL_ID,
    entry.name,
    entry.description,
    Float32Array.of(1, 0),
  );
  store.close();
  expect(
    await prepareSearch(
      { roots: [] },
      {
        indexPath,
        embedder: {
          ...embedder,
          indexKey: resolveEncoder("e5-small", { revision: "other" }).indexKey,
        },
        loadCatalog,
      },
    ),
  ).toMatchObject({ ranking: "lexical", reason: "vector_mismatch" });
});
