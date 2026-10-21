export {
  DEFAULT_MODEL_ID,
  encoderSpec,
  embeddingModels,
  resolveEncoder,
} from "./encoder.js";
export type {
  EncoderSpec,
  EncoderOptions,
  EmbeddingModel,
  ResolvedEncoder,
} from "./encoder.js";
export type { LoadEmbedderOptions } from "./embed/types.js";
export { loadEmbedder } from "./embed/load.js";
export { encodeEntries } from "./embed/entries.js";
export { describeHash } from "./embed/entries.js";
export type { EntryVectorStore } from "./embed/types.js";
export { openEntryVectors } from "./embed/vectors.js";
