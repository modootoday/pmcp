type Json = Record<string, unknown>;
export interface Lock {
  readonly workspaces: Readonly<Record<string, Json>>;
  readonly packages: Readonly<Record<string, unknown>>;
  readonly [field: string]: unknown;
}

export const DEP_FIELDS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
];

export const same = (a: unknown, b: unknown): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

export function depNames(meta: unknown): string[] {
  if (meta === null || typeof meta !== "object") return [];
  const names = new Set<string>();
  for (const field of DEP_FIELDS)
    for (const name of Object.keys(((meta as Json)[field] ?? {}) as object))
      names.add(name);
  return [...names];
}

// A key is a path of package names, "parent/child", where a name may be scoped.
export function parentKey(key: string): string | null {
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

export function workspacePathOf(entry: unknown): string | null {
  if (!Array.isArray(entry) || typeof entry[0] !== "string") return null;
  return /@workspace:(.+)$/u.exec(entry[0])?.[1] ?? null;
}

const nameOf = (manifest: Json | undefined): string =>
  typeof manifest?.["name"] === "string" ? manifest["name"] : "";

// One dependency as each revision resolves it; a hoisting move keeps the pair clean.
type Pair = readonly [string | null, string | null];
const pairId = ([b, h]: Pair): string => `${b ?? ""}\0${h ?? ""}`;

/**
 * For each workspace dir present at head, the dependency names whose resolved subtree
 * differs between the revisions. Keys are compared by what they resolve to, not by name.
 */
export function changedResolutions(
  base: Lock,
  head: Lock,
): Map<string, Set<string>> {
  const parents = new Map<string, Set<string>>();
  const dirty = new Set<string>();
  const seen = new Set<string>();
  const queue: Pair[] = [];
  const visit = (pair: Pair, parent: string | null): string => {
    const id = pairId(pair);
    if (parent !== null) {
      if (!parents.has(id)) parents.set(id, new Set());
      parents.get(id)!.add(parent);
    }
    if (!seen.has(id)) {
      seen.add(id);
      queue.push(pair);
    }
    return id;
  };
  const roots = new Map<string, Map<string, string>>();
  for (const [dir, manifest] of Object.entries(head.workspaces)) {
    const before = base.workspaces[dir];
    const ids = new Map<string, string>();
    for (const dep of new Set([...depNames(before), ...depNames(manifest)])) {
      const b = resolveFrom(base.packages, nameOf(before), dep);
      const h = resolveFrom(head.packages, nameOf(manifest), dep);
      ids.set(dep, visit([b, h], null));
    }
    roots.set(dir, ids);
  }
  while (queue.length > 0) {
    const pair = queue.pop()!;
    const [b, h] = pair;
    const id = pairId(pair);
    if (b === null || h === null) {
      if (b !== h) dirty.add(id);
      continue;
    }
    const entry = head.packages[h];
    if (!same(base.packages[b], entry)) {
      dirty.add(id);
      continue;
    }
    if (workspacePathOf(entry) !== null) continue;
    for (const dep of depNames(entryMeta(entry)))
      visit(
        [
          resolveFrom(base.packages, b, dep),
          resolveFrom(head.packages, h, dep),
        ],
        id,
      );
  }
  const up = [...dirty];
  while (up.length > 0)
    for (const parent of parents.get(up.pop()!) ?? [])
      if (!dirty.has(parent)) {
        dirty.add(parent);
        up.push(parent);
      }
  const out = new Map<string, Set<string>>();
  for (const [dir, ids] of roots) {
    const names = new Set<string>();
    for (const [dep, id] of ids) if (dirty.has(id)) names.add(dep);
    if (names.size > 0) out.set(dir, names);
  }
  return out;
}
