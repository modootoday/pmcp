import { resolve } from "node:path";

import {
  MARKETPLACE_RUNTIMES,
  type DeclaredMarketplace,
  type DeclaredPlugin,
  type MarketplaceRuntime,
  type MarketplaceSource,
} from "./types.js";

export type Fail = (message: string) => never;

const NAME = /^[a-z0-9][a-z0-9-]*$/u;
const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const KEYS = new Set(["source", "catalog", "plugins"]);

type Table = Record<string, unknown>;

function table(value: unknown, where: string, fail: Fail): Table {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return fail(`${where} must be a table`);
  return value as Table;
}

function named(name: string, where: string, fail: Fail): string {
  if (!NAME.test(name))
    return fail(`${where} ${name}: use lowercase, digits and -`);
  return name;
}

function source(
  value: unknown,
  where: string,
  root: string,
  fail: Fail,
): MarketplaceSource {
  const raw = table(value, `${where} source`, fail);
  const kinds = ["path", "github", "builtin"].filter((key) => key in raw);
  if (kinds.length !== 1)
    return fail(`${where} source needs exactly one of path, github or builtin`);
  if (typeof raw["path"] === "string" && raw["path"] !== "")
    return { kind: "path", path: resolve(root, raw["path"]) };
  if (raw["builtin"] === true) return { kind: "builtin" };
  const repo = raw["github"];
  if (typeof repo !== "string" || !REPO.test(repo))
    return fail(
      `${where} source must be { path }, { github = "owner/repo" } or { builtin = true }`,
    );
  const ref = raw["ref"];
  if (ref !== undefined && (typeof ref !== "string" || ref === ""))
    return fail(`${where} source ref must be a non-empty string`);
  return ref === undefined
    ? { kind: "github", repo }
    : { kind: "github", repo, ref };
}

function targets(
  value: unknown,
  where: string,
  fail: Fail,
): MarketplaceRuntime[] {
  const raw = table(value, where, fail);
  const list = raw["targets"];
  if (!Array.isArray(list) || !list.every((item) => typeof item === "string"))
    return fail(`${where} targets must be a list of strings`);
  for (const target of list) {
    if (!(MARKETPLACE_RUNTIMES as readonly string[]).includes(target))
      fail(`${where} unknown target ${target}`);
  }
  return [...new Set(list as MarketplaceRuntime[])];
}

function plugins(value: unknown, where: string, fail: Fail): DeclaredPlugin[] {
  if (value === undefined) return [];
  return Object.entries(table(value, `${where}.plugins`, fail))
    .map(([name, entry]) => ({
      name: named(name, `${where}.plugins`, fail),
      targets: targets(entry, `${where}.plugins.${name}`, fail),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function readMarketplaces(
  raw: unknown,
  root: string,
  fail: Fail,
): DeclaredMarketplace[] {
  if (raw === undefined) return [];
  const declared: DeclaredMarketplace[] = [];
  for (const [name, value] of Object.entries(
    table(raw, "[marketplaces]", fail),
  )) {
    const where = `[marketplaces.${named(name, "[marketplaces]", fail)}]`;
    const entry = table(value, where, fail);
    for (const key of Object.keys(entry)) {
      if (!KEYS.has(key)) fail(`${where} unknown key ${key}`);
    }
    if (entry["catalog"] !== undefined && typeof entry["catalog"] !== "boolean")
      fail(`${where} catalog must be a boolean`);
    const from = source(entry["source"], where, root, fail);
    const catalog = entry["catalog"] as boolean | undefined;
    if (catalog === true && from.kind === "github")
      fail(`${where} catalog needs a path or builtin source`);
    declared.push({
      name,
      source: from,
      ...(catalog === undefined ? {} : { catalog }),
      plugins: plugins(entry["plugins"], where, fail),
    });
  }
  return declared.sort((a, b) => a.name.localeCompare(b.name));
}
