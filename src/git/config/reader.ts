import { ConfigError } from "../../config.js";
import type { Argv } from "../types.js";

export type Table = Readonly<Record<string, unknown>>;

// Reject unknown keys so configuration typos cannot silently change workflow behavior.
export class Reader {
  constructor(
    private readonly path: string,
    private readonly name: string,
    private readonly table: Table,
    keys: readonly string[],
  ) {
    for (const key of Object.keys(table)) {
      if (!keys.includes(key))
        throw new ConfigError(path, `unknown key [${name}] ${key}`);
    }
  }

  private fail(key: string, expected: string): never {
    throw new ConfigError(
      this.path,
      `[${this.name}] ${key} must be ${expected}`,
    );
  }

  string(key: string): string | undefined {
    const value = this.table[key];
    if (value === undefined) return undefined;
    if (typeof value !== "string" || !value.trim())
      this.fail(key, "a non-empty string");
    return value;
  }

  envName(key: string): string | undefined {
    const value = this.string(key);
    if (value !== undefined && !/^[A-Z_][A-Z0-9_]{0,127}$/u.test(value))
      this.fail(key, "an environment variable name (A-Z, 0-9, _)");
    return value;
  }

  oneOf<T extends string>(key: string, values: readonly T[], fallback: T): T {
    const value = this.table[key] ?? fallback;
    if (!values.includes(value as T)) this.fail(key, values.join(" | "));
    return value as T;
  }

  bool(key: string, fallback: boolean): boolean {
    const value = this.table[key] ?? fallback;
    if (typeof value !== "boolean") this.fail(key, "a boolean");
    return value;
  }

  int(key: string, fallback: number): number {
    const value = this.table[key] ?? fallback;
    if (!Number.isInteger(value) || (value as number) < 1)
      this.fail(key, "a positive integer");
    return value as number;
  }

  list(key: string): readonly string[] {
    const value = this.table[key] ?? [];
    if (!Array.isArray(value) || !value.every((v) => typeof v === "string"))
      this.fail(key, "a list of strings");
    return value as string[];
  }

  argv(key: string): Argv | undefined {
    const value = this.list(key);
    if (value.length === 0) return undefined;
    return value;
  }
}

export function table(
  path: string,
  name: string,
  value: unknown,
): Table | undefined {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new ConfigError(path, `[${name}] must be a table`);
  return value as Table;
}

export function child(
  path: string,
  parent: Table | undefined,
  name: string,
  key: string,
): Table | undefined {
  return table(path, `${name}.${key}`, parent?.[key]);
}
