import {
  isToolchain,
  type LockfileAdapter,
  type LockfileInput,
  type LockfileDelta,
} from "./types.js";

type Json = Record<string, unknown>;
interface Lock {
  readonly workspaces: Readonly<Record<string, Json>>;
  readonly packages: Readonly<Record<string, unknown>>;
  readonly [field: string]: unknown;
}

const DEP_FIELDS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
];
const GRAPH_FIELDS = new Set(["workspaces", "packages"]);

// bun.lock is JSON with trailing commas and comments; strip both outside strings only.
export function parseBunLock(text: string): Lock {
  let out = "";
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i]!;
    if (c === '"') {
      const start = i;
      for (i += 1; i < text.length && text[i] !== '"'; i += 1)
        if (text[i] === "\\") i += 1;
      out += text.slice(start, i + 1);
      continue;
    }
    if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i += 1;
      out += "\n";
      continue;
    }
    if (c === ",") {
      let j = i + 1;
      while (j < text.length && /\s/u.test(text.charAt(j))) j += 1;
      if (text[j] === "}" || text[j] === "]") continue;
    }
    out += c;
  }
  const parsed = JSON.parse(out) as Json | null;
  if (parsed === null || typeof parsed !== "object")
    throw new Error("lockfile is not an object");
  for (const field of GRAPH_FIELDS)
    if (typeof parsed[field] !== "object" || parsed[field] === null)
      throw new Error(`lockfile has no ${field}`);
  return parsed as unknown as Lock;
}

const same = (a: unknown, b: unknown): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

function depNames(meta: unknown): string[] {
  if (meta === null || typeof meta !== "object") return [];
  const names = new Set<string>();
  for (const field of DEP_FIELDS)
    for (const name of Object.keys(((meta as Json)[field] ?? {}) as object))
      names.add(name);
  return [...names];
}

function rangeOf(manifest: Json | null, name: string): unknown {
  for (const field of DEP_FIELDS) {
    const range = (manifest?.[field] as Json | undefined)?.[name];
    if (range !== undefined) return range;
  }
  return undefined;
}

// A key is a path of package names, "parent/child", where a name may be scoped.
function parentKey(key: string): string | null {
  const parts = key.split("/");
  const names: string[] = [];
  for (let i = 0; i < parts.length; i += 1) {
    if (parts[i]!.startsWith("@") && i + 1 < parts.length) {
      names.push(`${parts[i]}/${parts[i + 1]}`);
      i += 1;
    } else names.push(parts[i]!);
  }
  return names.length <= 1 ? null : names.slice(0, -1).join("/");
}

function resolveFrom(
  packages: Lock["packages"],
  from: string,
  dep: string,
): string | null {
  for (let key: string | null = from; key; key = parentKey(key))
    if (packages[`${key}/${dep}`] !== undefined) return `${key}/${dep}`;
  return packages[dep] !== undefined ? dep : null;
}

function entryMeta(entry: unknown): unknown {
  if (!Array.isArray(entry)) return null;
  for (const at of [2, 1])
    if (entry[at] !== null && typeof entry[at] === "object") return entry[at];
  return null;
}

function workspacePathOf(entry: unknown): string | null {
  if (!Array.isArray(entry) || typeof entry[0] !== "string") return null;
  return /@workspace:(.+)$/u.exec(entry[0])?.[1] ?? null;
}

function addReverseEdges(lock: Lock, reverse: Map<string, Set<string>>): void {
  const add = (to: string | null, from: string): void => {
    if (to === null) return;
    if (!reverse.has(to)) reverse.set(to, new Set());
    reverse.get(to)!.add(from);
  };
  for (const [dir, manifest] of Object.entries(lock.workspaces)) {
    const from = typeof manifest?.["name"] === "string" ? manifest["name"] : "";
    for (const dep of depNames(manifest))
      add(resolveFrom(lock.packages, from, dep), `ws:${dir}`);
  }
  for (const [key, entry] of Object.entries(lock.packages)) {
    if (workspacePathOf(entry) !== null) continue;
    for (const dep of depNames(entryMeta(entry)))
      add(resolveFrom(lock.packages, key, dep), key);
  }
}

function rootDelta(
  base: Json | null,
  head: Json | null,
  input: LockfileInput,
  seeds: Set<string>,
): string | null {
  const fields = new Set([
    ...Object.keys(base ?? {}),
    ...Object.keys(head ?? {}),
  ]);
  for (const field of fields) {
    if (same(base?.[field], head?.[field])) continue;
    if (input.config.inertRootFields.includes(field)) continue;
    if (!DEP_FIELDS.includes(field))
      return `root package.json ${field} changed`;
  }
  for (const name of new Set([...depNames(base), ...depNames(head)])) {
    if (rangeOf(base, name) === rangeOf(head, name)) continue;
    if (isToolchain(name, input.config.toolchain))
      return `root toolchain dependency ${name} changed`;
    seeds.add(name);
  }
  return null;
}

function lockDelta(input: LockfileInput): LockfileDelta {
  const read = (rev: string, path: string): string | null =>
    input.read(rev, path);
  const json = (text: string | null): Json | null =>
    text === null ? null : (JSON.parse(text) as Json);
  const lock = (text: string | null): Lock | null =>
    text === null ? null : parseBunLock(text);
  const basePkg = json(read(input.base, "package.json"));
  const headPkg = json(read(input.head, "package.json"));
  if (basePkg === null || headPkg === null)
    return { all: "no root package.json at one revision", direct: [] };
  const seeds = new Set<string>();
  const rootAll = rootDelta(basePkg, headPkg, input, seeds);
  if (rootAll !== null) return { all: rootAll, direct: [] };
  const baseLock = lock(read(input.base, "bun.lock"));
  const headLock = lock(read(input.head, "bun.lock"));
  if ((baseLock === null) !== (headLock === null))
    return { all: "bun.lock exists at only one revision", direct: [] };
  const empty: Lock = { workspaces: {}, packages: {} };
  const base = baseLock ?? empty;
  const head = headLock ?? empty;
  for (const field of new Set([...Object.keys(base), ...Object.keys(head)]))
    if (!GRAPH_FIELDS.has(field) && !same(base[field], head[field]))
      return { all: `bun.lock ${field} changed`, direct: [] };
  const direct = new Set<string>();
  for (const dir of new Set([
    ...Object.keys(base.workspaces),
    ...Object.keys(head.workspaces),
  ])) {
    if (dir === "" || head.workspaces[dir] === undefined) continue;
    if (!same(base.workspaces[dir], head.workspaces[dir])) direct.add(dir);
  }
  for (const key of new Set([
    ...Object.keys(base.packages),
    ...Object.keys(head.packages),
  ])) {
    if (same(base.packages[key], head.packages[key])) continue;
    if (parentKey(key) === null && isToolchain(key, input.config.toolchain))
      return { all: `toolchain package ${key} changed`, direct: [] };
    const moved = workspacePathOf(head.packages[key]);
    if (moved !== null) direct.add(moved);
    seeds.add(key);
  }
  const reverse = new Map<string, Set<string>>();
  addReverseEdges(base, reverse);
  addReverseEdges(head, reverse);
  const seen = new Set(seeds);
  const queue = [...seeds];
  while (queue.length > 0) {
    for (const from of reverse.get(queue.pop()!) ?? []) {
      if (seen.has(from)) continue;
      seen.add(from);
      if (!from.startsWith("ws:")) queue.push(from);
      else if (from !== "ws:") direct.add(from.slice(3));
    }
  }
  return { all: null, direct: [...direct].sort() };
}

export const bunLockfile: LockfileAdapter = {
  files: ["bun.lock", "package.json"],
  delta(input) {
    try {
      return lockDelta(input);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return { all: `lockfile unreadable: ${reason}`, direct: [] };
    }
  },
};
