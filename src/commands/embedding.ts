import { resolve } from "node:path";
import { ArgumentError, one, type CommandContext } from "../cli/command.js";
import { resolveEncoder, type EncoderDtype } from "../encoder.js";
import type { LoadEmbedderOptions } from "../embed.js";
import { configFrom } from "./config-from.js";

export { EMBEDDING_OPTIONS } from "./options/embedding.js";

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
