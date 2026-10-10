import { describe, expect, it } from "vitest";
import { loadEmbedder } from "../src/embed.js";

const modelId = "onnx-community/embeddinggemma-300m-ONNX";

function nativeModule(
  output: {
    sentence_embedding?: { data: Float32Array };
    last_hidden_state?: { data: Float32Array };
  } = { sentence_embedding: { data: new Float32Array(768) } },
) {
  const texts: string[] = [];
  const configurations: Record<string, unknown>[] = [];
  const settings: Record<string, unknown>[] = [];
  const sources: string[] = [];
  const module = {
    AutoConfig: {
      from_pretrained: async (id: string) => {
        sources.push(id);
        const config = { vision_config: {}, audio_config: {} };
        configurations.push(config);
        return config;
      },
    },
    AutoTokenizer: {
      from_pretrained: async (
        _id: string,
        options: Record<string, unknown>,
      ) => {
        settings.push(options);
        sources.push(_id);
        return (text: string) => {
          texts.push(text);
          return { input_ids: [1] };
        };
      },
    },
    AutoModel: {
      from_pretrained: async (
        _id: string,
        options: Record<string, unknown>,
      ) => {
        settings.push(options);
        sources.push(_id);
        return async () => output;
      },
    },
    pipeline: async () => {
      throw new Error("Hidden-state pooling must not be used");
    },
  };
  return { module, texts, configurations, settings, sources };
}

describe("EmbeddingGemma encoder", () => {
  it("uses projected sentence embeddings and the asymmetric task prefixes", async () => {
    const fake = nativeModule();
    const embedder = await loadEmbedder(modelId, {
      module: fake.module,
      dtype: "q4",
      localOnly: true,
      cacheDir: "/models",
    });
    expect(embedder).not.toBeNull();
    expect(
      (await embedder!.embed("\ud55c\uad6d\uc5b4 \ubb38\uc7a5")).length,
    ).toBe(768);
    await embedder!.embedPassage!("Skill description");
    expect(fake.texts).toEqual([
      "task: search result | query: \ud55c\uad6d\uc5b4 \ubb38\uc7a5",
      "title: none | text: Skill description",
    ]);
    expect(fake.settings[0]).toMatchObject({
      dtype: "q4",
      local_files_only: true,
      cache_dir: "/models",
    });
  });

  it("disables vision and audio encoders in the text-only Gemma 2 path", async () => {
    const fake = nativeModule();
    await loadEmbedder("onnx-community/embeddinggemma-2-ONNX", {
      module: fake.module,
    });
    expect(fake.configurations[0]).toEqual({
      vision_config: null,
      audio_config: null,
    });
    expect(fake.settings[1]?.config).toBe(fake.configurations[0]);
    expect(fake.settings[0]).not.toHaveProperty("config");
  });

  it("refuses a hidden-state-only export", async () => {
    const fake = nativeModule({
      last_hidden_state: { data: new Float32Array(768) },
    });
    const embedder = await loadEmbedder(modelId, { module: fake.module });
    await expect(embedder!.embed("query")).rejects.toThrow(
      "sentence_embedding",
    );
  });

  it("loads qualified local files while retaining the catalog model identity", async () => {
    const fake = nativeModule();
    const embedder = await loadEmbedder(modelId, {
      module: fake.module,
      modelPath: "/models/qualified-revision",
      localOnly: true,
    });
    expect(fake.sources).toEqual([
      "/models/qualified-revision",
      "/models/qualified-revision",
    ]);
    expect(embedder!.modelId).toBe(modelId);
  });

  it("refuses non-finite projected vectors", async () => {
    const vector = new Float32Array(768);
    vector[0] = NaN;
    const fake = nativeModule({ sentence_embedding: { data: vector } });
    const embedder = await loadEmbedder(modelId, { module: fake.module });
    await expect(embedder!.embed("query")).rejects.toThrow("non-finite");
  });

  it("returns null when the installed peer lacks native model factories", async () => {
    expect(
      await loadEmbedder(modelId, { module: { pipeline: async () => {} } }),
    ).toBeNull();
  });

  it("truncates Matryoshka output and normalizes the retained dimensions", async () => {
    const vector = new Float32Array(768).fill(1);
    vector[0] = 3;
    const fake = nativeModule({ sentence_embedding: { data: vector } });
    const embedder = await loadEmbedder("embeddinggemma-2", {
      module: fake.module,
      dimensions: 128,
      cacheDir: "/models",
      localOnly: true,
    });
    const output = await embedder!.embed("\ud55c\uad6d\uc5b4 \ubb38\uc7a5");
    expect(output.length).toBe(128);
    expect(Math.hypot(...output)).toBeCloseTo(1);
    expect(output[0]! / output[1]!).toBeCloseTo(3);
    expect(
      fake.sources.every((source) =>
        source.endsWith("daa72c51243991dfcaf9f9137d2c573d8f7790c0"),
      ),
    ).toBe(true);
  });
});
