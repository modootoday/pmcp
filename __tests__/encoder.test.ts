import { describe, expect, it } from "vitest";
import {
  DEFAULT_MODEL_ID,
  embeddingModels,
  resolveEncoder,
} from "../src/encoder.js";

describe("embedding model identity", () => {
  it("preserves legacy E5 indexes and canonicalizes aliases", () => {
    expect(resolveEncoder().indexKey).toBe(DEFAULT_MODEL_ID);
    expect(resolveEncoder("e5-small")).toEqual(
      resolveEncoder(DEFAULT_MODEL_ID),
    );
    const gemma = embeddingModels().find(
      (model) => model.name === "embeddinggemma-2",
    )!;
    expect(resolveEncoder(gemma.name)).toEqual(resolveEncoder(gemma.modelId));
    expect(resolveEncoder(gemma.name).dtype).toBe("q4");
    expect(resolveEncoder(gemma.name).revision).toBe(gemma.revision);
  });

  it("isolates precision, revision, width and encoding semantics", () => {
    const model = "embeddinggemma-2";
    const identities = [
      resolveEncoder(model),
      resolveEncoder(model, { dtype: "q8" }),
      resolveEncoder(model, { revision: "different-revision" }),
      resolveEncoder(model, { dimensions: 256 }),
      resolveEncoder(model, { encoder: { queryPrefix: "query: " } }),
      resolveEncoder(model, { encoder: { passagePrefix: "passage: " } }),
      resolveEncoder(model, { encoder: { pooling: "cls" } }),
      resolveEncoder(model, { encoder: { projected: false } }),
    ];
    expect(new Set(identities.map((value) => value.indexKey)).size).toBe(
      identities.length,
    );
    expect(resolveEncoder(model, { dimensions: 768 }).indexKey).toBe(
      resolveEncoder(model).indexKey,
    );
  });

  it("returns independent preset metadata", () => {
    const first = embeddingModels()[0]!;
    (first.dimensions as number[]).push(99);
    (first.encoder as { queryPrefix: string }).queryPrefix = "modified";
    expect(embeddingModels()[0]!.dimensions).toEqual([384]);
    expect(resolveEncoder("e5-small").encoder.queryPrefix).toBe("query: ");
  });

  it.each([
    ["e5-small", { dtype: "q4" }],
    ["embeddinggemma-2", { dtype: "fp16" }],
    ["embeddinggemma-2", { dimensions: 129 }],
    ["embeddinggemma-2", { dimensions: NaN }],
    ["embeddinggemma-2", { revision: " " }],
    ["vendor/model", { encoder: { pooling: "max" } }],
  ])("rejects unsupported settings for %s", (model, options) => {
    expect(() =>
      resolveEncoder(
        model as string,
        options as Parameters<typeof resolveEncoder>[1],
      ),
    ).toThrow();
  });
});
