import { ConfigError } from "../../config.js";
import type { Table } from "./types.js";

export const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/u;
export const KEYS = new Set([
  "auth",
  "command",
  "args",
  "env",
  "env_vars",
  "env_from",
  "cwd",
  "url",
  "headers",
  "header_env",
  "bearer_token_env_var",
  "native",
  "targets",
  "tools",
  "mailbox",
]);

export function fail(path: string, where: string, detail: string): never {
  throw new ConfigError(path, `${where} ${detail}`);
}

export function object(path: string, where: string, value: unknown): Table {
  if (value === undefined) {
    return {};
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(path, where, "must be a table");
  }
  return value as Table;
}

export function list(
  path: string,
  where: string,
  value: unknown,
  unique = true,
): string[] {
  if (value === undefined) {
    return [];
  }
  if (
    !Array.isArray(value) ||
    !value.every((item) => typeof item === "string" && item !== "")
  ) {
    fail(path, where, "must be a list of nonempty strings");
  }
  if (unique && new Set(value).size !== value.length) {
    fail(path, where, "contains duplicates");
  }
  return value;
}

export function mapping(
  path: string,
  where: string,
  value: unknown,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, item] of Object.entries(object(path, where, value))) {
    if (typeof item !== "string") {
      fail(path, where, "values must be strings");
    }
    result[key] = item;
  }
  return result;
}
