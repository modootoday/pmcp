import { type EncoderOptions } from "../encoder.js";
export interface LoadEmbedderOptions extends EncoderOptions {
  readonly cacheDir?: string;
  readonly modelPath?: string;
  readonly localOnly?: boolean;
  readonly module?: unknown;
}
export interface FeatureExtractionOutput {
  readonly data: ArrayLike<number>;
}
export type Pipeline = (
  text: string,
  options: {
    pooling: "mean" | "cls";
    normalize: boolean;
  },
) => Promise<FeatureExtractionOutput>;
export interface TransformersModule {
  readonly pipeline?: unknown;
  readonly env?: Record<string, unknown>;
  readonly AutoTokenizer?: unknown;
  readonly AutoModel?: unknown;
  readonly AutoConfig?: unknown;
}
export interface PretrainedFactory {
  from_pretrained(
    model: string,
    options: Record<string, unknown>,
  ): Promise<unknown>;
}
export interface EntryVectorStore {
  read(modelId: string): Map<string, Float32Array>;
  stale(modelId: string, entries: ReadonlyMap<string, string>): string[];
  write(
    modelId: string,
    name: string,
    description: string,
    vector: Float32Array,
  ): void;
  close(): void;
}
