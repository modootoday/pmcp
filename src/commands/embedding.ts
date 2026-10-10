import { resolve } from "node:path";
import {
  ArgumentError,
  one,
  type CommandContext,
  type OptionSpec,
} from "../cli/command.js";
import { resolveEncoder, type EncoderDtype } from "../encoder.js";
import type { LoadEmbedderOptions } from "../embed.js";
import { configFrom } from "./roots.js";

export const EMBEDDING_OPTIONS: readonly OptionSpec[] = [
  {
    name: "model",
    describe: "Embedding preset or model ID; list presets with pmcp models",
    placeholder: "<name>",
  },
  {
    name: "dtype",
    describe: "Weight precision; uses the selected model default when omitted",
    placeholder: "<q4|q8|fp32>",
  },
  {
    name: "dimensions",
    describe:
      "Supported output width; uses the model's full output when omitted",
    placeholder: "<number>",
  },
  {
    name: "model-revision",
    describe: "Model revision used for loading and index identity",
    placeholder: "<revision>",
  },
  {
    name: "model-path",
    describe: "Local model artifact directory",
    placeholder: "<dir>",
  },
  {
    name: "model-cache",
    describe: "Model cache directory",
    placeholder: "<dir>",
  },
  {
    name: "query-prefix",
    describe: "Custom model's query instruction prefix",
    placeholder: "<text>",
  },
  {
    name: "passage-prefix",
    describe: "Custom model's document instruction prefix",
    placeholder: "<text>",
  },
  {
    name: "pooling",
    describe: "Custom model's pooling method",
    placeholder: "<mean|cls>",
  },
];

export interface EmbeddingSelection extends LoadEmbedderOptions {
  readonly modelId?: string;
  readonly enabled?: boolean;
}

export function embeddingFrom(context: CommandContext): EmbeddingSelection {
  const configuration = configFrom(context)?.embedding ?? {};
  const dimension = one(context.args, "dimensions");
  const modelPath = one(context.args, "model-path");
  const cacheDir = one(context.args, "model-cache");
  const queryPrefix = one(context.args, "query-prefix");
  const passagePrefix = one(context.args, "passage-prefix");
  const pooling = one(context.args, "pooling");
  const selection: EmbeddingSelection = {
    ...configuration,
    modelId: one(context.args, "model") ?? configuration.modelId,
    dtype:
      (one(context.args, "dtype") as EncoderDtype | undefined) ??
      configuration.dtype,
    dimensions:
      dimension === undefined ? configuration.dimensions : Number(dimension),
    revision: one(context.args, "model-revision") ?? configuration.revision,
    modelPath:
      modelPath === undefined
        ? configuration.modelPath
        : resolve(context.cwd, modelPath),
    cacheDir:
      cacheDir === undefined
        ? configuration.cacheDir
        : resolve(context.cwd, cacheDir),
    encoder: {
      ...configuration.encoder,
      ...(queryPrefix === undefined ? {} : { queryPrefix }),
      ...(passagePrefix === undefined ? {} : { passagePrefix }),
      ...(pooling === undefined ? {} : { pooling: pooling as "mean" | "cls" }),
    },
  };
  try {
    resolveEncoder(selection.modelId, selection);
  } catch (error) {
    throw new ArgumentError(
      error instanceof Error ? error.message : "Invalid embedding options",
    );
  }
  return selection;
}
