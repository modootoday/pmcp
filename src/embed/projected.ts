import { type ResolvedEncoder } from "../encoder.js";
import type { LoadEmbedderOptions } from "./types.js";
import type { FeatureExtractionOutput } from "./types.js";
import type { Pipeline } from "./types.js";
import type { TransformersModule } from "./types.js";
import type { PretrainedFactory } from "./types.js";
export function pretrainedFactory(value: unknown): PretrainedFactory | null {
  if (!value || !["object", "function"].includes(typeof value)) return null;
  const candidate = value as PretrainedFactory;
  return typeof candidate.from_pretrained === "function" ? candidate : null;
}
export async function loadProjectedEncoder(
  module: TransformersModule,
  selected: ResolvedEncoder,
  source: string,
  options: LoadEmbedderOptions,
): Promise<Pipeline | null> {
  const tokenizers = pretrainedFactory(module.AutoTokenizer);
  const models = pretrainedFactory(module.AutoModel);
  if (!tokenizers || !models) return null;
  const settings: Record<string, unknown> = {
    dtype: selected.dtype,
    revision: selected.revision,
    local_files_only: options.localOnly ?? false,
  };
  if (options.cacheDir !== undefined) settings.cache_dir = options.cacheDir;
  const modelSettings = { ...settings };
  if (selected.modelId === "onnx-community/embeddinggemma-2-ONNX") {
    const configurations = pretrainedFactory(module.AutoConfig);
    if (!configurations) return null;
    const config = (await configurations.from_pretrained(
      source,
      settings,
    )) as Record<string, unknown>;
    config.vision_config = null;
    config.audio_config = null;
    modelSettings.config = config;
  }
  const tokenizer = (await tokenizers.from_pretrained(source, settings)) as (
    text: string,
    options: Record<string, unknown>,
  ) => unknown;
  const model = (await models.from_pretrained(source, modelSettings)) as (
    inputs: unknown,
  ) => Promise<{
    sentence_embedding?: FeatureExtractionOutput;
  }>;
  return async (text) => {
    const output = await model(
      tokenizer(text, { padding: true, truncation: true }),
    );
    const vector = output.sentence_embedding;
    const gemma = selected.modelId.startsWith("onnx-community/embeddinggemma-");
    if (
      !vector ||
      vector.data.length === 0 ||
      (gemma && vector.data.length !== 768)
    )
      throw new Error(
        "EmbeddingGemma requires its projected 768-dimensional sentence_embedding",
      );
    if (!Array.from(vector.data).every(Number.isFinite))
      throw new Error("EmbeddingGemma returned a non-finite embedding");
    return vector;
  };
}
