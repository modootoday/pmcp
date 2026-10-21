import { ConfigError } from "../../config.js";
import { isClaudeRule } from "./grammar.js";
import { BUCKETS, type Bucket, type PermissionSpec } from "./types.js";

const CONTROL = /[\u0000-\u001f\u007f]/u;

type Table = Record<string, unknown>;

function table(path: string, where: string, value: unknown): Table {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new ConfigError(path, `${where} must be a table`);
  return value as Table;
}

function rules(path: string, bucket: Bucket, value: unknown): string[] {
  const where = `[permissions.claude] ${bucket}`;
  if (!Array.isArray(value) || !value.every((v) => typeof v === "string"))
    throw new ConfigError(path, `${where} must be a list of strings`);
  for (const rule of value) {
    if (rule === "") throw new ConfigError(path, `${where}: empty rule`);
    if (CONTROL.test(rule))
      throw new ConfigError(path, `${where}: rule has a control character`);
    if (!isClaudeRule(rule))
      throw new ConfigError(
        path,
        `${where}: ${rule} is not a Claude permission rule`,
      );
  }
  return [...new Set(value as string[])];
}

// One expression in two buckets would leave its effect to native precedence, so the author picks one.
export function readPermissions(
  path: string,
  raw: unknown,
): PermissionSpec | undefined {
  if (raw === undefined) return undefined;
  const root = table(path, "[permissions]", raw);
  for (const key of Object.keys(root))
    if (key !== "claude")
      throw new ConfigError(path, `[permissions] unknown key ${key}`);
  if (root["claude"] === undefined) return undefined;
  const claude = table(path, "[permissions.claude]", root["claude"]);
  const declared: Partial<Record<Bucket, string[]>> = {};
  const seen = new Map<string, Bucket>();
  for (const [key, value] of Object.entries(claude)) {
    if (!(BUCKETS as readonly string[]).includes(key))
      throw new ConfigError(path, `[permissions.claude] unknown key ${key}`);
    const bucket = key as Bucket;
    declared[bucket] = rules(path, bucket, value);
    for (const rule of declared[bucket]) {
      const other = seen.get(rule);
      if (other !== undefined)
        throw new ConfigError(
          path,
          `[permissions.claude] ${rule} is declared in both ${other} and ${bucket}`,
        );
      seen.set(rule, bucket);
    }
  }
  return { claude: declared };
}
