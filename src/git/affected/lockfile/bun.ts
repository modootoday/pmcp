import { workspacePatterns } from "../members.js";
import {
  changedResolutions,
  DEP_FIELDS,
  depNames,
  parentKey,
  same,
  workspacePathOf,
  type Lock,
} from "./bun-graph.js";
import {
  isToolchain,
  rootMapping,
  type LockfileAdapter,
  type LockfileInput,
  type LockfileDelta,
  type RootDependencyHit,
} from "./types.js";

type Json = Record<string, unknown>;

const GRAPH_FIELDS = new Set(["workspaces", "packages"]);

// bun.lock is JSON with trailing commas and comments; strip both outside strings only.
export function parseBunLock(text: string): Lock {
  const out: string[] = [];
  const special = /["/,]/gu;
  let copied = 0;
  for (let match = special.exec(text); match; match = special.exec(text)) {
    let i = match.index;
    const c = text[i]!;
    if (c === '"') {
      for (i += 1; i < text.length && text[i] !== '"'; i += 1)
        if (text[i] === "\\") i += 1;
      special.lastIndex = i + 1;
      continue;
    }
    if (c === "/" && text[i + 1] === "/") {
      out.push(text.slice(copied, i));
      while (i < text.length && text[i] !== "\n") i += 1;
      copied = i;
    } else if (c === ",") {
      let j = i + 1;
      while (j < text.length && /\s/u.test(text.charAt(j))) j += 1;
      if (text[j] !== "}" && text[j] !== "]") continue;
      out.push(text.slice(copied, i));
      copied = i + 1;
    }
    special.lastIndex = Math.max(copied, i + 1);
  }
  out.push(text.slice(copied));
  const parsed = JSON.parse(out.join("")) as Json | null;
  if (parsed === null || typeof parsed !== "object")
    throw new Error("lockfile is not an object");
  for (const field of GRAPH_FIELDS)
    if (typeof parsed[field] !== "object" || parsed[field] === null)
      throw new Error(`lockfile has no ${field}`);
  return parsed as unknown as Lock;
}

function rangeOf(manifest: Json | null, name: string): unknown {
  for (const field of DEP_FIELDS) {
    const range = (manifest?.[field] as Json | undefined)?.[name];
    if (range !== undefined) return range;
  }
  return undefined;
}

function readable(manifest: Json | null): boolean {
  try {
    workspacePatterns(manifest ?? {});
    return true;
  } catch {
    return false;
  }
}

function rootDelta(
  base: Json | null,
  head: Json | null,
  input: LockfileInput,
  rootNames: Set<string>,
  moved: { workspaces: boolean },
): string | null {
  const fields = new Set([
    ...Object.keys(base ?? {}),
    ...Object.keys(head ?? {}),
  ]);
  for (const field of fields) {
    if (same(base?.[field], head?.[field])) continue;
    if (input.config.inertRootFields.includes(field)) continue;
    // Changed member globs select the members they add or remove; the caller compares them.
    if (field === "workspaces" && readable(base) && readable(head)) {
      moved.workspaces = true;
      continue;
    }
    if (!DEP_FIELDS.includes(field))
      return `root package.json ${field} changed`;
  }
  for (const name of new Set([...depNames(base), ...depNames(head)])) {
    if (rangeOf(base, name) === rangeOf(head, name)) continue;
    if (isToolchain(name, input.config.toolchain))
      return `root toolchain dependency ${name} changed`;
    rootNames.add(name);
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
  const rootNames = new Set<string>();
  const moved = { workspaces: false };
  const rootAll = rootDelta(basePkg, headPkg, input, rootNames, moved);
  if (rootAll !== null) return { all: rootAll, direct: [] };
  const answer = lockOnly(input, rootNames, read, lock);
  return moved.workspaces && answer.all === null
    ? { ...answer, workspaces: true }
    : answer;
}

function lockOnly(
  input: LockfileInput,
  rootNames: Set<string>,
  read: (rev: string, path: string) => string | null,
  lock: (text: string | null) => Lock | null,
): LockfileDelta {
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
  let changed = false;
  for (const key of new Set([
    ...Object.keys(base.packages),
    ...Object.keys(head.packages),
  ])) {
    if (same(base.packages[key], head.packages[key])) continue;
    if (parentKey(key) === null && isToolchain(key, input.config.toolchain))
      return { all: `toolchain package ${key} changed`, direct: [] };
    const moved = workspacePathOf(head.packages[key]);
    if (moved !== null) direct.add(moved);
    changed = true;
  }
  if (changed)
    for (const [dir, names] of changedResolutions(base, head)) {
      if (dir !== "") {
        direct.add(dir);
        continue;
      }
      for (const name of names) rootNames.add(name);
    }
  return mapRoot(input, rootNames, [...direct].sort());
}

// Without [git.affected.root_dependencies] the root's own dependencies select nothing, as
// before; with it each one must be mapped, and one that is not selects ALL.
function mapRoot(
  input: LockfileInput,
  names: ReadonlySet<string>,
  direct: readonly string[],
): LockfileDelta {
  const table = input.rootDependencies;
  if (table === undefined || names.size === 0) return { all: null, direct };
  const mapped: RootDependencyHit[] = [];
  for (const name of [...names].sort()) {
    const hit = rootMapping(name, table);
    if (hit === null)
      return {
        all: `root dependency ${name} changed and [git.affected.root_dependencies] does not map it`,
        direct: [],
      };
    mapped.push(hit);
  }
  return { all: null, direct, mapped };
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
