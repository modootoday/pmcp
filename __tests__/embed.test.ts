import { describe, expect, it } from "vitest";

import {
  DEFAULT_MODEL_ID,
  encodeEntries,
  encoderSpec,
  loadEmbedder,
} from "../src/embed.js";
import type { Embedder } from "../src/find.js";

function fakeTransformers() {
  const seen: { text: string; pooling: string }[] = [];
  const loaded: { model: string; options: Record<string, unknown> }[] = [];
  const env: Record<string, unknown> = {};
  return {
    seen,
    loaded,
    env,
    module: {
      env,
      pipeline: async (
        _task: string,
        model: string,
        settings: Record<string, unknown>,
      ) => {
        loaded.push({ model, options: settings });
        return async (text: string, options: { pooling: string }) => {
          seen.push({ text, pooling: options.pooling });
          return { data: [1, 0, 0] };
        };
      },
    },
  };
}

describe("encoderSpec", () => {
  it("defaults to a multilingual E5 model with its query and passage prefixes", () => {
    expect(DEFAULT_MODEL_ID).toBe("Xenova/multilingual-e5-small");
    expect(encoderSpec(DEFAULT_MODEL_ID)).toMatchObject({
      queryPrefix: "query: ",
      passagePrefix: "passage: ",
    });
  });

  it("writes an unknown model's text unprefixed", () => {
    expect(encoderSpec("someone/other-model")).toEqual({
      queryPrefix: "",
      passagePrefix: "",
      pooling: "mean",
    });
  });
});

describe("loadEmbedder", () => {
  it("prefixes the intent as a query and a description as a passage", async () => {
    const fake = fakeTransformers();
    const embedder = await loadEmbedder(DEFAULT_MODEL_ID, {
      module: fake.module,
    });
    await embedder!.embed("字幕を分ける");
    await embedder!.embedPassage!("Time subtitles to a voice track");
    expect(fake.seen.map((s) => s.text)).toEqual([
      "query: 字幕を分ける",
      "passage: Time subtitles to a voice track",
    ]);
    expect(embedder!.dims).toBe(3);
  });

  it("points the runtime at a baked model directory and forbids downloads", async () => {
    const fake = fakeTransformers();
    await loadEmbedder(DEFAULT_MODEL_ID, {
      module: fake.module,
      cacheDir: "/srv/models",
      localOnly: true,
    });
    expect(fake.loaded[0]).toMatchObject({
      model: "/srv/models/Xenova/multilingual-e5-small",
      options: {
        cache_dir: "/srv/models",
        local_files_only: true,
        dtype: "q8",
      },
    });
    expect(fake.env).toEqual({});
  });

  it("applies a custom encoder without changing shared runtime policy", async () => {
    const fake = fakeTransformers();
    const embedder = await loadEmbedder("vendor/model", {
      module: fake.module,
      encoder: {
        queryPrefix: "intent: ",
        passagePrefix: "document: ",
        pooling: "cls",
      },
    });
    await embedder!.embed("find skills");
    await embedder!.embedPassage!("search skills");
    expect(fake.seen).toEqual([
      { text: "intent: find skills", pooling: "cls" },
      { text: "document: search skills", pooling: "cls" },
    ]);
    expect(fake.env).toEqual({});
  });

  it("returns null when the runtime has no pipeline", async () => {
    expect(await loadEmbedder(DEFAULT_MODEL_ID, { module: {} })).toBeNull();
  });
});

describe("encodeEntries", () => {
  it("re-encodes only descriptions that changed", async () => {
    const calls: string[] = [];
    const embedder: Embedder = {
      modelId: "fake",
      dims: 1,
      embed: async () => Float32Array.of(0),
      embedPassage: async (text) => {
        calls.push(text);
        return Float32Array.of(text.length);
      },
    };
    const first = await encodeEntries(embedder, [
      { name: "a", description: "one" },
      { name: "b", description: "two" },
    ]);
    calls.length = 0;
    const second = await encodeEntries(
      embedder,
      [
        { name: "a", description: "one" },
        { name: "b", description: "two, reworded" },
      ],
      first,
    );
    expect(calls).toEqual(["two, reworded"]);
    expect(second.get("a")).toBe(first.get("a"));
  });
});
