export type { IntentCache, IntentCacheStats } from "./intent.js";
export { normaliseIntent } from "./intent.js";

// bun:sqlite. Import this subpath only from a bun runtime.
export type { IntentCacheOptions } from "./cache.js";
export { DEFAULT_INTENT_CACHE_LIMIT, openIntentCache } from "./cache.js";

export type { AssetKind, CatalogOptions, SkillEntry } from "./catalog.js";
export {
  ASSET_KINDS,
  MAX_SKILL_DEPTH,
  kindOf,
  SKIPPED_DIRS,
  displayPath,
  readBody,
  readCatalog,
  readFrontmatter,
  withoutBody,
} from "./catalog.js";

export type {
  Embedder,
  FindOptions,
  FindResult,
  Match,
  Ranking,
} from "./find.js";
export { DEFAULT_FIND_LIMIT, cosine, find, lexicalScore } from "./find.js";
export { prepareSearch } from "./search.js";
export type { SearchOptions, PreparedSearch } from "./search.js";
export {
  DEFAULT_MODEL_ID,
  loadEmbedder,
  encodeEntries,
  openEntryVectors,
} from "./embed.js";
export type { EntryVectorStore, LoadEmbedderOptions } from "./embed.js";
export { resolveEncoder, encoderSpec, embeddingModels } from "./encoder.js";
export type {
  EncoderSpec,
  EncoderOptions,
  EncoderDtype,
  EmbeddingModel,
  ResolvedEncoder,
} from "./encoder.js";

export type { MetadataLeaf, MetadataValue } from "./frontmatter.js";
export type { Rejection } from "./marketplace.js";
export {
  assetRoot,
  readFrontmatterText,
  readMarketplace,
  readMetadata,
} from "./marketplace.js";

export type { Runtime } from "./runtime.js";
export {
  RUNTIMES,
  detectRuntime,
  runtimeOfClient,
  verifiedRuntimesOf,
} from "./runtime.js";

export type {
  CatalogSection,
  ProjectConfig,
  EmbeddingSection,
} from "./config.js";
export { CONFIG_FILE, ConfigError, findConfig, readConfig } from "./config.js";

export type { Output } from "./project/outputs.js";
export type {
  McpServerSpec,
  PackageRulesSpec,
  ProjectSpec,
  Tool,
} from "./project/spec.js";
export { TOOLS, readSpec } from "./project/spec.js";
export { plan } from "./project/plan.js";
export type { ProjectResult } from "./project/apply.js";
export { LOCK_FILE, deadGlobs, project } from "./project/apply.js";
export type { Finding, Runner } from "./project/doctor.js";
export { doctor } from "./project/doctor.js";
export { ProjectError, deriveName } from "./project/package-rules.js";

export type {
  CallResponse,
  CatalogItem,
  CatalogResponse,
  KindFilter,
  ReadResult,
  SkillFilters,
  SkillServerOptions,
  SkillTools,
} from "./server.js";
export {
  CATALOG_PAGE_MAX,
  CATALOG_PAGE_SIZE,
  DESCRIBE_FILE_LIMIT,
  READ_BUDGET_BYTES,
  createSkillTools,
} from "./server.js";

export type { SkillMcpOptions } from "./mcp.js";
export {
  SERVER_NAME,
  SERVER_VERSION,
  createSkillServer,
  registerSkillTools,
} from "./mcp.js";

export type { BundleFile, SkillBundle } from "./files/bundle.js";
export { bundleSkill } from "./files/bundle.js";
export type { SkillFile, SkillFileListing } from "./files/list.js";
export { listSkillFiles } from "./files/list.js";
export type { SkillFileContent } from "./files/read.js";
export { readSkillFile } from "./files/read.js";
export { resolveSkillFileUri, skillFileUri } from "./files/uri.js";
export type { Classified, FileKind } from "./mime.js";
export { classify, isUtf8Text, mimeOf } from "./mime.js";
export {
  COMPATIBILITY_MAX,
  DESCRIPTION_MAX,
  NAME_MAX,
  frontmatterObject as parseSkillFrontmatter,
  specProblems,
} from "./frontmatter.js";
export type { Finding as ValidationFinding } from "./validate.js";
export { validateCatalog, validateSkillDir } from "./validate.js";
export { registerSkillResources } from "./resources.js";
export { promptName, registerSkillPrompts } from "./prompts.js";
export {
  bundleResponseSchema,
  catalogResponseSchema,
  describeResponseSchema,
  findResultSchema,
} from "./tools/schemas.js";

export type { SkillExtensionEntry, SkillResource } from "./skills-extension.js";
export {
  SKILLS_EXTENSION,
  extensionEntry,
  registerSkillsExtension,
  skillUri,
} from "./skills-extension.js";
