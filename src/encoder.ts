import { createHash } from "node:crypto";

export const DEFAULT_MODEL_ID = "Xenova/multilingual-e5-small";
export type EncoderDtype = "q4" | "q8" | "fp32";

export interface EncoderSpec {
  readonly queryPrefix: string;
  readonly passagePrefix: string;
  readonly pooling: "mean" | "cls";
  readonly projected?: boolean;
}

export interface EncoderOptions {
  readonly dtype?: EncoderDtype;
  readonly dimensions?: number;
  readonly revision?: string;
  readonly encoder?: Partial<EncoderSpec>;
}

export interface EmbeddingModel {
  readonly name: string;
  readonly modelId: string;
  readonly dtype: EncoderDtype;
  readonly dtypes: readonly EncoderDtype[];
  readonly dimensions: readonly number[];
  readonly revision: string;
  readonly encoder: EncoderSpec;
}

const PLAIN: EncoderSpec = {
  queryPrefix: "",
  passagePrefix: "",
  pooling: "mean",
};
const E5: EncoderSpec = {
  queryPrefix: "query: ",
  passagePrefix: "passage: ",
  pooling: "mean",
};
const GEMMA: EncoderSpec = {
  queryPrefix: "task: search result | query: ",
  passagePrefix: "title: none | text: ",
  pooling: "mean",
  projected: true,
};

const MODELS: readonly EmbeddingModel[] = [
  {
    name: "e5-small",
    modelId: DEFAULT_MODEL_ID,
    dtype: "q8",
    dtypes: ["q8", "fp32"],
    dimensions: [384],
    revision: "main",
    encoder: E5,
  },
  {
    name: "embeddinggemma-300m",
    modelId: "onnx-community/embeddinggemma-300m-ONNX",
    dtype: "q4",
    dtypes: ["q4", "q8", "fp32"],
    dimensions: [768, 512, 256, 128],
    revision: "5090578d9565bb06545b4552f76e6bc2c93e4a66",
    encoder: GEMMA,
  },
  {
    name: "embeddinggemma-2",
    modelId: "onnx-community/embeddinggemma-2-ONNX",
    dtype: "q4",
    dtypes: ["q4", "q8", "fp32"],
    dimensions: [768, 512, 256, 128],
    revision: "daa72c51243991dfcaf9f9137d2c573d8f7790c0",
    encoder: GEMMA,
  },
];

export function embeddingModels(): readonly EmbeddingModel[] {
  return MODELS.map((model) => ({
    ...model,
    dtypes: [...model.dtypes],
    dimensions: [...model.dimensions],
    encoder: { ...model.encoder },
  }));
}

export function encoderSpec(modelId: string): EncoderSpec {
  const known = MODELS.find(
    (model) => model.name === modelId || model.modelId === modelId,
  );
  if (known) return { ...known.encoder };
  if (/^Xenova\/multilingual-e5-(base|large)$/.test(modelId)) return { ...E5 };
  if (modelId === "Xenova/bge-m3") return { ...PLAIN, pooling: "cls" };
  return { ...PLAIN };
}

export interface ResolvedEncoder {
  readonly modelId: string;
  readonly dtype: EncoderDtype;
  readonly dimensions?: number;
  readonly revision: string;
  readonly encoder: EncoderSpec;
  readonly indexKey: string;
}

export function resolveEncoder(
  model: string = DEFAULT_MODEL_ID,
  options: EncoderOptions = {},
): ResolvedEncoder {
  if (typeof model !== "string" || !model.trim())
    throw new Error("Embedding model must be a non-empty name or model ID");
  const preset = MODELS.find(
    (item) => item.name === model || item.modelId === model,
  );
  const modelId = preset?.modelId ?? model;
  const dtype = options.dtype ?? preset?.dtype ?? "q8";
  if (!["q4", "q8", "fp32"].includes(dtype))
    throw new Error("Embedding dtype must be q4, q8 or fp32");
  if (preset && !preset.dtypes.includes(dtype))
    throw new Error(`${preset.name} does not support ${dtype}`);
  const dimensions = options.dimensions;
  if (
    dimensions !== undefined &&
    (!Number.isSafeInteger(dimensions) ||
      !preset?.dimensions.includes(dimensions))
  )
    throw new Error(`Unsupported embedding dimensions for ${model}`);
  const revision = options.revision ?? preset?.revision ?? "main";
  if (typeof revision !== "string" || !revision.trim())
    throw new Error("Embedding revision must be a non-empty string");
  const encoder = { ...encoderSpec(modelId), ...options.encoder };
  if (
    typeof encoder.queryPrefix !== "string" ||
    typeof encoder.passagePrefix !== "string"
  )
    throw new Error("Encoder prefixes must be strings");
  if (!["mean", "cls"].includes(encoder.pooling))
    throw new Error("Encoder pooling must be mean or cls");
  if (encoder.projected !== undefined && typeof encoder.projected !== "boolean")
    throw new Error("Encoder projected must be a boolean");
  const identity = {
    version: 1,
    modelId,
    dtype,
    revision,
    dimensions: dimensions ?? preset?.dimensions[0] ?? null,
    encoder: {
      queryPrefix: encoder.queryPrefix,
      passagePrefix: encoder.passagePrefix,
      pooling: encoder.pooling,
      projected: encoder.projected ?? false,
    },
  };
  const legacy =
    modelId === DEFAULT_MODEL_ID &&
    dtype === "q8" &&
    revision === "main" &&
    (dimensions === undefined || dimensions === 384) &&
    encoder.queryPrefix === E5.queryPrefix &&
    encoder.passagePrefix === E5.passagePrefix &&
    encoder.pooling === E5.pooling &&
    !encoder.projected;
  const fingerprint = createHash("sha256")
    .update(JSON.stringify(identity))
    .digest("hex");
  return {
    modelId,
    dtype,
    dimensions,
    revision,
    encoder,
    indexKey: legacy ? modelId : `${modelId}#${fingerprint}`,
  };
}
