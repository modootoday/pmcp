import { posix } from "node:path";

import { globPattern } from "../../glob.js";
import type { AffectedConfig } from "./config.js";
import { readDelta, showFile, type Change } from "./delta.js";
import { deriveReaders } from "./derive.js";
import { withConsumers } from "./graph.js";
import { bunLockfile } from "./lockfile/bun.js";
import { workspaceMembers, type Member } from "./members.js";

export interface Selection {
  readonly all: boolean;
  // Why everything is selected; absent when the selection is a member list.
  readonly reason?: string;
  readonly base?: string;
  readonly head?: string;
  // Members the delta touches, lockfile consumers included: what tests run.
  readonly changed: readonly string[];
  // changed plus their consumers when [git.affected] consumers is on: what typechecks.
  readonly members: readonly string[];
  readonly unmapped: readonly string[];
}

const ALL = (reason: string, extra: Partial<Selection> = {}): Selection => ({
  all: true,
  reason,
  changed: [],
  members: [],
  unmapped: [],
  ...extra,
});

function matcher(globs: readonly string[]): (path: string) => boolean {
  const patterns = globs.map((glob) => globPattern(glob));
  return (path) => patterns.some((pattern) => pattern.test(path));
}

// The last matching glob decides, so "!<glob>" takes back part of an earlier one.
function ordered(globs: readonly string[]): (path: string) => boolean {
  const rules = globs.map((glob) => ({
    exclude: glob.startsWith("!"),
    pattern: globPattern(glob.replace(/^!/u, "")),
  }));
  return (path) => {
    let hit = false;
    for (const rule of rules) if (rule.pattern.test(path)) hit = !rule.exclude;
    return hit;
  };
}

function ownerWalk(
  path: string,
  dirs: ReadonlySet<string>,
): string | undefined {
  for (
    let dir = posix.dirname(path);
    dir !== "." && dir !== "/";
    dir = posix.dirname(dir)
  )
    if (dirs.has(dir)) return dir;
  return undefined;
}

function lockfileMembers(
  root: string,
  config: AffectedConfig,
  changes: readonly Change[],
  base: string,
  head: string,
): { all: string | null; direct: readonly string[] } {
  if (config.lockfile === undefined) return { all: null, direct: [] };
  const adapter = bunLockfile;
  if (!changes.some((change) => adapter.files.includes(change.path)))
    return { all: null, direct: [] };
  return adapter.delta({
    read: (rev, path) => showFile(root, rev, path),
    base,
    head,
    config: config.lockfile,
  });
}

function membersOf(root: string): Member[] | Error {
  try {
    return workspaceMembers(root);
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
}

export function selectAffected(
  root: string,
  config: AffectedConfig,
  baseRef: string,
  headRef: string,
  testsOnly = false,
): Selection {
  const delta = readDelta(root, baseRef, headRef);
  if (!delta.ok) return ALL(delta.reason);
  const { base, head, changes } = delta;
  const at = { base, head };
  const shared = matcher(config.sharedInputs);
  const hit = changes.find((change) => shared(change.path));
  if (hit) return ALL(`shared input ${hit.path} changed`, at);
  const members = membersOf(root);
  if (members instanceof Error)
    return ALL(`members unreadable: ${members.message}`, at);
  const dirs = new Set(members.map((member) => member.dir));
  const lock = lockfileMembers(root, config, changes, base, head);
  if (lock.all !== null) return ALL(lock.all, at);

  const changed = new Set<string>();
  const direct = lock.direct.filter((dir) => dirs.has(dir));
  if (direct.length > 0)
    for (const dir of withConsumers(root, members, direct)) changed.add(dir);

  const ignored = matcher(config.ignore);
  const included = ordered(config.include);
  const deletedIncluded = ordered(config.includeDeleted);
  const owners = Object.entries(config.owners).map(([glob, member]) => ({
    test: matcher([glob]),
    member,
  }));
  const readers = Object.entries(config.readers).map(([glob, list]) => ({
    test: matcher([glob]),
    list,
  }));
  const derived = deriveReaders(root, members, config.derive);
  const memberChange = changes.some(
    (change) =>
      (change.status === "A" || change.status === "D") &&
      posix.basename(change.path) === "package.json" &&
      change.path !== "package.json" &&
      included(change.path) &&
      !ignored(change.path),
  );
  if (memberChange) for (const dir of config.onMemberChange) changed.add(dir);

  const unmapped: string[] = [];
  const lockFiles = config.lockfile ? bunLockfile.files : [];
  for (const { path, status } of changes) {
    if (ignored(path)) continue;
    let claimed = false;
    for (const rule of readers)
      if (rule.test(path)) {
        rule.list.forEach((dir) => changed.add(dir));
        claimed = true;
      }
    for (const dir of derived.get(path) ?? []) {
      changed.add(dir);
      claimed = true;
    }
    // The lockfile adapter answered for its own files above.
    if (lockFiles.includes(path) || !included(path)) continue;
    if (status === "D" && !deletedIncluded(path)) continue;
    const owner =
      owners.find((rule) => rule.test(path))?.member ?? ownerWalk(path, dirs);
    if (owner !== undefined) changed.add(owner);
    else if (!claimed) unmapped.push(path);
  }
  // A named member that is not one (retired, or a fixture) would hand the runner a target it lacks.
  const list = [...changed].filter((dir) => dirs.has(dir)).sort();
  if (unmapped.length > 0 && config.unmapped === "all")
    return ALL(`unmapped ${unmapped[0]}`, { ...at, unmapped });
  // Tests are not widened to consumers, so a tests-only answer skips reading every source.
  const wide =
    config.consumers && !testsOnly ? withConsumers(root, members, list) : list;
  return { all: false, ...at, changed: list, members: wide, unmapped };
}
