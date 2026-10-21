import type { Embedder } from "../find.js";
import { resolve } from "node:path";
import { resolveEncoder } from "../encoder.js";
import type { LoadEmbedderOptions } from "./types.js";
import type { Pipeline } from "./types.js";
import type { TransformersModule } from "./types.js";
import { TRANSFORMERS } from "./_shared.js";
import { loadProjectedEncoder } from "./projected.js";
export async function loadEmbedder(
  modelId?: string,
  options: LoadEmbedderOptions = {},
): Promise<Embedder | null> {
  const selected = resolveEncoder(modelId, options);
  let module: TransformersModule;
  try {
    module = (options.module ??
      (await import(TRANSFORMERS))) as TransformersModule;
  } catch {
    return null;
  }
  let source = options.modelPath ?? selected.modelId;
  if (options.localOnly && !options.modelPath) {
    const cache = options.cacheDir ?? module.env?.cacheDir;
    if (typeof cache !== "string")
      throw new Error("Provide modelPath or cacheDir for an offline encoder");
    source = resolve(
      cache,
      selected.modelId,
      selected.revision === "main" ? "." : selected.revision,
    );
  }
  const spec = selected.encoder;
  let encode: Pipeline;
  if (spec.projected) {
    const projected = await loadProjectedEncoder(
      module,
      selected,
      source,
      options,
    );
    if (!projected) return null;
    encode = projected;
  } else {
    const factory = module.pipeline;
    if (typeof factory !== "function") return null;
    encode = (await (
      factory as (
        task: string,
        model: string,
        options: Record<string, unknown>,
      ) => Promise<Pipeline>
    )("feature-extraction", source, {
      dtype: selected.dtype,
      revision: selected.revision,
      cache_dir: options.cacheDir,
      local_files_only: options.localOnly ?? false,
    })) as Pipeline;
  }
  let dims = 0;
  const run = async (text: string): Promise<Float32Array> => {
    const output = await encode(text, {
      pooling: spec.pooling,
      normalize: true,
    });
    let vector = Float32Array.from(output.data);
    if (vector.length === 0 || !vector.every(Number.isFinite))
      throw new Error("Encoder returned an invalid embedding");
    if (selected.dimensions !== undefined) {
      if (selected.dimensions > vector.length)
        throw new Error(
          "Encoder output is smaller than the requested dimensions",
        );
      vector = vector.slice(0, selected.dimensions);
      const norm = Math.hypot(...vector);
      if (norm === 0 || !Number.isFinite(norm))
        throw new Error("Encoder returned a zero embedding");
      vector = vector.map((value) => value / norm);
    }
    dims = vector.length;
    return vector;
  };
  return {
    modelId: selected.modelId,
    indexKey: selected.indexKey,
    get dims() {
      return dims;
    },
    embed: (text) => run(spec.queryPrefix + text),
    embedPassage: (text) => run(spec.passagePrefix + text),
  };
}
