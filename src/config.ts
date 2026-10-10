/**
 * `pmcp.toml`, the project's one record of where its catalog lives.
 *
 * Paths in it are relative to the file, so the same file works from any
 * directory a host starts pmcp in. Catalog and embedding settings are checked
 * here; projector sections are kept as given.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { parse } from "smol-toml";
import { resolveEncoder, type EncoderOptions } from "./encoder.js";

export const CONFIG_FILE = "pmcp.toml";

/** What `[catalog]` may say. Each mirrors the repeatable CLI flag of the same meaning. */
export interface CatalogSection {
  readonly roots?: readonly string[];
  readonly scopes?: readonly string[];
  readonly workspaces?: readonly string[];
  readonly packages?: readonly string[];
  readonly marketplaces?: readonly string[];
}

export interface ProjectConfig {
  /** Absolute path of the file read. */
  readonly path: string;
  /** Its directory; every relative path in the file resolves against it. */
  readonly dir: string;
  /** `[catalog]` with paths already absolute. */
  readonly catalog: CatalogSection;
  readonly embedding?: EmbeddingSection;
  /** The whole document, for sections this module does not interpret. */
  readonly raw: Readonly<Record<string, unknown>>;
}

export interface EmbeddingSection extends EncoderOptions {
  readonly enabled?: boolean;
  readonly modelId?: string;
  readonly modelPath?: string;
  readonly cacheDir?: string;
}

function embeddingSection(
  path: string,
  dir: string,
  value: unknown,
): EmbeddingSection | undefined {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new ConfigError(path, "[embedding] must be a table");
  const section = value as Record<string, unknown>;
  const allowed = new Set([
    "enabled",
    "model",
    "dtype",
    "dimensions",
    "revision",
    "model_path",
    "cache_dir",
    "encoder",
  ]);
  for (const key of Object.keys(section)) {
    if (!allowed.has(key))
      throw new ConfigError(path, `unknown key [embedding] ${key}`);
  }
  if (section.enabled !== undefined && typeof section.enabled !== "boolean")
    throw new ConfigError(path, "[embedding] enabled must be a boolean");
  const string = (key: string): string | undefined => {
    const item = section[key];
    if (item === undefined) return undefined;
    if (typeof item !== "string" || !item.trim())
      throw new ConfigError(
        path,
        `[embedding] ${key} must be a non-empty string`,
      );
    return item;
  };
  let encoder: EncoderOptions["encoder"];
  if (section.encoder !== undefined) {
    if (
      section.encoder === null ||
      typeof section.encoder !== "object" ||
      Array.isArray(section.encoder)
    )
      throw new ConfigError(path, "[embedding.encoder] must be a table");
    const source = section.encoder as Record<string, unknown>;
    const keys = new Set([
      "query_prefix",
      "passage_prefix",
      "pooling",
      "projected",
    ]);
    for (const key of Object.keys(source)) {
      if (!keys.has(key))
        throw new ConfigError(path, `unknown key [embedding.encoder] ${key}`);
    }
    encoder = {};
    if (source.query_prefix !== undefined)
      encoder = { ...encoder, queryPrefix: source.query_prefix as string };
    if (source.passage_prefix !== undefined)
      encoder = { ...encoder, passagePrefix: source.passage_prefix as string };
    if (source.pooling !== undefined)
      encoder = { ...encoder, pooling: source.pooling as "mean" | "cls" };
    if (source.projected !== undefined)
      encoder = { ...encoder, projected: source.projected as boolean };
  }
  const modelPath = string("model_path");
  const cacheDir = string("cache_dir");
  const result: EmbeddingSection = {
    modelId: string("model"),
    dtype: string("dtype") as EncoderOptions["dtype"],
    dimensions: section.dimensions as number | undefined,
    revision: string("revision"),
    encoder,
    enabled: section.enabled as boolean | undefined,
    modelPath: modelPath === undefined ? undefined : resolve(dir, modelPath),
    cacheDir: cacheDir === undefined ? undefined : resolve(dir, cacheDir),
  };
  try {
    resolveEncoder(result.modelId, result);
  } catch (error) {
    throw new ConfigError(
      path,
      error instanceof Error
        ? error.message
        : "Invalid embedding configuration",
    );
  }
  return result;
}

export class ConfigError extends Error {
  constructor(path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = "ConfigError";
  }
}

const PATH_KEYS = ["roots", "workspaces", "packages", "marketplaces"] as const;
const CATALOG_KEYS: ReadonlySet<string> = new Set([...PATH_KEYS, "scopes"]);

/** The nearest pmcp.toml at or above start, or null when there is none. */
export function findConfig(start: string): string | null {
  let dir = resolve(start);
  for (;;) {
    const candidate = join(dir, CONFIG_FILE);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function stringList(path: string, key: string, value: unknown): string[] {
  if (!Array.isArray(value) || !value.every((v) => typeof v === "string")) {
    throw new ConfigError(path, `[catalog] ${key} must be a list of strings`);
  }
  return value;
}

/**
 * Reads and checks one file. An unknown key under `[catalog]` is an error
 * rather than ignored, for the same reason an unknown flag is: a misspelt
 * `workspace = [...]` must not look like it worked.
 */
export function readConfig(path: string): ProjectConfig {
  const absolute = resolve(path);
  const dir = dirname(absolute);
  let raw: Record<string, unknown>;
  try {
    raw = parse(readFileSync(absolute, "utf8")) as Record<string, unknown>;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unreadable";
    throw new ConfigError(absolute, reason.split("\n")[0] ?? reason);
  }

  const section = raw["catalog"];
  const embedding = embeddingSection(absolute, dir, raw.embedding);
  const configured = embedding === undefined ? {} : { embedding };
  if (section === undefined)
    return { path: absolute, dir, catalog: {}, raw, ...configured };
  if (
    section === null ||
    typeof section !== "object" ||
    Array.isArray(section)
  ) {
    throw new ConfigError(absolute, "[catalog] must be a table");
  }

  const catalog: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(section)) {
    if (!CATALOG_KEYS.has(key)) {
      throw new ConfigError(absolute, `unknown key [catalog] ${key}`);
    }
    const list = stringList(absolute, key, value);
    catalog[key] = key === "scopes" ? list : list.map((p) => resolve(dir, p));
  }
  return { path: absolute, dir, catalog, raw, ...configured };
}
