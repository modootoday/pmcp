export type { IntentCache, IntentCacheStats } from "./intent.js";
export { normaliseIntent } from "./intent.js";

// bun:sqlite. Import this subpath only from a bun runtime.
export type { IntentCacheOptions } from "./cache.js";
export { DEFAULT_INTENT_CACHE_LIMIT, openIntentCache } from "./cache.js";

export type { CatalogOptions, SkillEntry } from "./catalog.js";
export {
  MAX_SKILL_DEPTH,
  SKIPPED_DIRS,
  displayPath,
  readBody,
  readCatalog,
  readFrontmatter,
  withoutBody,
} from "./catalog.js";

export type { Embedder, FindOptions, FindResult, Match, Ranking } from "./find.js";
export { DEFAULT_FIND_LIMIT, cosine, find, lexicalScore } from "./find.js";

export type {
  CallResponse,
  CatalogResponse,
  SkillServerOptions,
  SkillTools,
} from "./server.js";
export { createSkillTools } from "./server.js";

export { SERVER_NAME, createSkillServer, registerSkillTools } from "./mcp.js";
