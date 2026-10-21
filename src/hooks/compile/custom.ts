import type { CompiledCustom } from "../compiled.js";
import { RUNTIME_IDS, type RuntimeId } from "../contract.js";
import { guardHash, guardScript } from "../policies/custom.js";
import { compareIdentifiers } from "./order.js";
import {
  CUSTOM_TARGETS,
  type CustomEntry,
  type CustomTarget,
  type Table,
} from "./types.js";

const isRuntime = (target: string): target is RuntimeId =>
  RUNTIME_IDS.includes(target as RuntimeId);

// The shell adapter serves these runtimes when the bundle does not; claude, grok and opencode
// have no shell adapter, so their custom guards need the bundle.
const SHELL_SERVED: readonly CustomTarget[] = [
  "codex",
  "gemini",
  "antigravity",
];

// A target the bundle does not run stays with the shell adapter; one neither serves is an
// error, so a custom guard is never dropped without a word.
export function legacyEntries(
  entries: readonly CustomEntry[],
  enabled: boolean,
  bundleTargets: readonly RuntimeId[] = [],
): CustomEntry[] {
  const bundled = enabled ? bundleTargets : [];
  const unserved = entries
    .flatMap((entry) => entry.targets)
    .find((id) => !SHELL_SERVED.includes(id) && !bundled.includes(id));
  if (unserved)
    throw new Error(
      `${unserved} custom guards need [hooks] targets that include ${unserved}`,
    );
  if (enabled) {
    return entries
      .map((entry) => ({
        ...entry,
        targets: entry.targets.filter((id) => !bundled.includes(id)),
      }))
      .filter((entry) => entry.targets.length > 0);
  }
  if (
    entries.some(
      (entry) =>
        entry.event === "after_edit" &&
        entry.targets.some((id) => id !== "codex"),
    )
  ) {
    throw new Error("edit hooks currently support codex only");
  }
  return [...entries];
}

export function pinnedEntries(
  root: string,
  entries: readonly CustomEntry[],
  targets: readonly RuntimeId[],
): CompiledCustom[] {
  return entries
    .map((entry) => ({
      ...entry,
      targets: entry.targets.filter(
        (id): id is RuntimeId => isRuntime(id) && targets.includes(id),
      ),
    }))
    .filter((entry) => entry.targets.length > 0)
    .map((entry) => ({
      ...entry,
      guardSha256: guardHash(root, entry.command),
    }));
}

const FIELDS = ["name", "command", "targets", "timeout_ms", "on"];
const EVENTS = ["before_shell", "after_edit"];

function readEntry(
  root: string,
  value: unknown,
  implied: CustomEntry["event"] | undefined,
): CustomEntry {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error("shell entry must be a table");
  const entry = value as Table;
  if (
    Object.keys(entry).some(
      (key) => !FIELDS.includes(key) || (key === "on" && implied),
    )
  ) {
    throw new Error("unknown shell entry field");
  }
  const { name, command, targets } = entry;
  const timeoutMs = entry["timeout_ms"] ?? 15000;
  const event = implied ?? entry["on"] ?? "before_shell";
  if (typeof name !== "string" || !/^[a-z0-9][a-z0-9-]*$/u.test(name)) {
    throw new Error("shell names must be unique lowercase names");
  }
  const parts = Array.isArray(command) ? command : [];
  if (
    parts.length === 0 ||
    !parts.every(
      (part) =>
        typeof part === "string" && part.length > 0 && !part.includes("\0"),
    )
  ) {
    throw new Error("command must be a nonempty argument list");
  }
  const list = Array.isArray(targets) ? targets : [];
  if (
    list.length === 0 ||
    !list.every((id) => CUSTOM_TARGETS.includes(id)) ||
    new Set(list).size !== list.length
  ) {
    throw new Error("targets must select unique supported shell adapters");
  }
  if (
    typeof timeoutMs !== "number" ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 100 ||
    timeoutMs > 60000
  ) {
    throw new Error("timeout_ms must be an integer from 100 to 60000");
  }
  if (typeof event !== "string" || !EVENTS.includes(event))
    throw new Error(`on must be one of ${EVENTS.join(", ")}`);
  guardScript(root, parts as string[]);
  return {
    name,
    command: parts as string[],
    targets: list as CustomTarget[],
    timeoutMs,
    event: event as CustomEntry["event"],
  };
}

export function readCustom(
  root: string,
  hooks: Table,
  guards: Table,
): CustomEntry[] {
  const sources: [unknown, CustomEntry["event"] | undefined][] = [
    [hooks["shell"], "before_shell"],
    [hooks["edit"], "after_edit"],
    [guards["custom"], undefined],
  ];
  const names = new Set<string>();
  const found: CustomEntry[] = [];
  for (const [list, implied] of sources) {
    if (list === undefined) continue;
    if (!Array.isArray(list))
      throw new Error("custom guards must be arrays of tables");
    for (const value of list) {
      const entry = readEntry(root, value, implied);
      if (names.has(entry.name))
        throw new Error("shell names must be unique lowercase names");
      names.add(entry.name);
      found.push(entry);
    }
  }
  return found.sort((a, b) => compareIdentifiers(a.name, b.name));
}
