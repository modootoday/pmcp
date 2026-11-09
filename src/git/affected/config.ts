import { ConfigError, type ProjectConfig } from "../../config.js";
import { child, Reader, table, type Table } from "../config/reader.js";

export type Unmapped = "all" | "report";
export type Derive = "tsconfig" | "vitest";

export interface LockfileConfig {
  readonly adapter: "bun";
  // Package names (a trailing * matches a prefix) every member builds with.
  readonly toolchain: readonly string[];
  readonly inertRootFields: readonly string[];
}

export interface AffectedConfig {
  readonly members: "workspaces";
  readonly sharedInputs: readonly string[];
  readonly readers: Readonly<Record<string, readonly string[]>>;
  readonly owners: Readonly<Record<string, string>>;
  readonly ignore: readonly string[];
  readonly include: readonly string[];
  readonly includeDeleted: readonly string[];
  readonly onMemberChange: readonly string[];
  readonly derive: readonly Derive[];
  readonly unmapped: Unmapped;
  readonly consumers: boolean;
  readonly lockfile?: LockfileConfig;
  // Root package.json dependency name (a trailing * matches a prefix) to the members using it.
  // Declared, it maps each root dependency change; one it does not map selects ALL.
  readonly rootDependencies?: Readonly<Record<string, readonly string[]>>;
}

const DERIVE: readonly Derive[] = ["tsconfig", "vitest"];

function stringMap(path: string, name: string, value: unknown): Table {
  return table(path, name, value) ?? {};
}

function memberLists(
  path: string,
  name: string,
  value: unknown,
): Readonly<Record<string, readonly string[]>> {
  const out: Record<string, readonly string[]> = {};
  for (const [key, members] of Object.entries(stringMap(path, name, value))) {
    if (!Array.isArray(members) || !members.every((m) => typeof m === "string"))
      throw new ConfigError(
        path,
        `[${name}] "${key}" must be a list of member directories`,
      );
    out[key] = members as string[];
  }
  return out;
}

function readers(
  path: string,
  source: Table,
): Readonly<Record<string, readonly string[]>> {
  return memberLists(path, "git.affected.readers", source["readers"]);
}

function owners(path: string, source: Table): Readonly<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const [glob, member] of Object.entries(
    stringMap(path, "git.affected.owners", source["owners"]),
  )) {
    if (typeof member !== "string" || !member.trim())
      throw new ConfigError(
        path,
        `[git.affected.owners] "${glob}" must name one member directory`,
      );
    out[glob] = member;
  }
  return out;
}

function lockfile(path: string, source: Table): LockfileConfig {
  const read = new Reader(path, "git.affected.lockfile", source, [
    "adapter",
    "toolchain",
    "inert_root_fields",
  ]);
  return {
    adapter: read.oneOf("adapter", ["bun"], "bun"),
    toolchain: read.list("toolchain"),
    inertRootFields:
      source["inert_root_fields"] === undefined
        ? ["scripts", "description", "version"]
        : read.list("inert_root_fields"),
  };
}

// Absent [git.affected] returns null: the command then answers ALL, as nothing is described.
export function readAffectedConfig(
  config: ProjectConfig,
): AffectedConfig | null {
  const { path, raw } = config;
  const git = table(path, "git", raw["git"]);
  const source = child(path, git, "git", "affected");
  if (source === undefined) return null;
  const read = new Reader(path, "git.affected", source, [
    "members",
    "shared_inputs",
    "readers",
    "owners",
    "ignore",
    "include",
    "include_deleted",
    "on_member_change",
    "derive",
    "unmapped",
    "consumers",
    "lockfile",
    "root_dependencies",
  ]);
  const derive = read.list("derive");
  for (const name of derive)
    if (!DERIVE.includes(name as Derive))
      throw new ConfigError(
        path,
        `[git.affected] derive accepts ${DERIVE.join(", ")}, not ${name}`,
      );
  const lockTable = child(path, source, "git.affected", "lockfile");
  const rootDependencies =
    source["root_dependencies"] === undefined
      ? undefined
      : memberLists(
          path,
          "git.affected.root_dependencies",
          source["root_dependencies"],
        );
  // Only the lockfile adapter reads the root manifest's dependency fields.
  if (rootDependencies && !lockTable)
    throw new ConfigError(
      path,
      "[git.affected.root_dependencies] needs [git.affected.lockfile]",
    );
  return {
    members: read.oneOf("members", ["workspaces"], "workspaces"),
    sharedInputs: read.list("shared_inputs"),
    readers: readers(path, source),
    owners: owners(path, source),
    ignore: read.list("ignore"),
    include: source["include"] === undefined ? ["**"] : read.list("include"),
    includeDeleted: read.list("include_deleted"),
    onMemberChange: read.list("on_member_change"),
    derive: derive as Derive[],
    unmapped: read.oneOf<Unmapped>("unmapped", ["all", "report"], "all"),
    consumers: read.bool("consumers", false),
    ...(lockTable ? { lockfile: lockfile(path, lockTable) } : {}),
    ...(rootDependencies ? { rootDependencies } : {}),
  };
}
