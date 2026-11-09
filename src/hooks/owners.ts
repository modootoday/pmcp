// [[owners]]: which person or session looks after a path, so an agent that edits or delivers
// it is told whom to tell. Notices only; nothing here refuses. The hook bundle loads this
// module, so it imports nothing but the glob helper.

import { globPattern } from "./glob.js";

export interface OwnerEntry {
  readonly paths: readonly string[];
  readonly owner: string;
  readonly note?: string;
  // warn tells the agent; observe only logs.
  readonly mode: "warn" | "observe";
}

const FIELDS = ["paths", "owner", "note", "mode"];

function readEntry(value: unknown, at: number): OwnerEntry {
  const where = `[[owners]] entry ${at + 1}`;
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${where} must be a table`);
  const entry = value as Record<string, unknown>;
  const unknown = Object.keys(entry).find((key) => !FIELDS.includes(key));
  if (unknown) throw new Error(`${where}: unknown key ${unknown}`);
  const paths = entry["paths"];
  if (
    !Array.isArray(paths) ||
    paths.length === 0 ||
    !paths.every(
      (glob) =>
        typeof glob === "string" &&
        glob !== "" &&
        !glob.startsWith("/") &&
        !glob.split("/").includes(".."),
    )
  )
    throw new Error(
      `${where}: paths must be a nonempty list of globs inside the project`,
    );
  const owner = entry["owner"];
  if (typeof owner !== "string" || owner.trim() === "")
    throw new Error(`${where}: owner must be a name`);
  const note = entry["note"];
  if (note !== undefined && typeof note !== "string")
    throw new Error(`${where}: note must be a string`);
  const mode = entry["mode"] ?? "warn";
  if (mode !== "warn" && mode !== "observe")
    throw new Error(`${where}: mode must be warn or observe`);
  return {
    paths: paths as string[],
    owner,
    ...(note !== undefined && note !== "" ? { note } : {}),
    mode,
  };
}

export function readOwners(value: unknown): OwnerEntry[] {
  if (value === undefined) return [];
  if (!Array.isArray(value))
    throw new Error("[[owners]] must be an array of tables");
  return value.map(readEntry);
}

// The entries whose globs match a project-relative path, in the order written.
export function ownersOf(
  entries: readonly OwnerEntry[],
  path: string,
): OwnerEntry[] {
  return entries.filter((entry) =>
    entry.paths.some((glob) => globPattern(glob).test(path)),
  );
}

export function ownerLine(entry: OwnerEntry, path: string): string {
  return `${path} belongs to ${entry.owner}${entry.note ? `: ${entry.note}` : ""}`;
}

// One line per warn entry that some path matches: its first path, and how many more.
export function ownerNotices(
  entries: readonly OwnerEntry[],
  paths: Iterable<string>,
): string[] {
  const hits = new Map<OwnerEntry, string[]>();
  for (const path of paths)
    for (const entry of ownersOf(entries, path)) {
      if (entry.mode !== "warn") continue;
      hits.set(entry, [...(hits.get(entry) ?? []), path]);
    }
  return [...hits].map(([entry, matched]) => {
    const sorted = [...matched].sort();
    const more = sorted.length > 1 ? ` (and ${sorted.length - 1} more)` : "";
    return `${ownerLine(entry, sorted[0]!)}${more}`;
  });
}
