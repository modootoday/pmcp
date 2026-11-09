import type { CompiledExternal } from "../compiled.js";
import { compareIdentifiers } from "./order.js";

const FIELDS = [
  "name",
  "paths",
  "command",
  "timeout_ms",
  "mode",
  "stdin",
  "on_error",
];
const MODES = ["deny", "warn", "observe", "off"];

function stringList(value: unknown, what: string): string[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    !value.every(
      (item) => typeof item === "string" && item !== "" && !item.includes("\0"),
    )
  )
    throw new Error(`${what} must be a nonempty list of strings`);
  return value as string[];
}

function readEntry(value: unknown): CompiledExternal | null {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error("[[hooks.guards.external]] entries must be tables");
  const entry = value as Record<string, unknown>;
  const unknown = Object.keys(entry).find((key) => !FIELDS.includes(key));
  if (unknown)
    throw new Error(`[[hooks.guards.external]] unknown field ${unknown}`);
  const name = entry["name"];
  if (typeof name !== "string" || !/^[a-z0-9][a-z0-9-]*$/u.test(name))
    throw new Error(
      "[[hooks.guards.external]] name must be a lowercase name (a-z, 0-9, -)",
    );
  const where = `[[hooks.guards.external]] ${name}:`;
  const paths = stringList(entry["paths"], `${where} paths`);
  if (paths.some((glob) => glob.startsWith("/") || glob.includes("..")))
    throw new Error(`${where} paths are globs inside the project`);
  const command = stringList(entry["command"], `${where} command`);
  const timeoutMs = entry["timeout_ms"] ?? 15000;
  if (
    typeof timeoutMs !== "number" ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 100 ||
    timeoutMs > 60000
  )
    throw new Error(`${where} timeout_ms must be an integer from 100 to 60000`);
  const mode = entry["mode"] ?? "observe";
  if (typeof mode !== "string" || !MODES.includes(mode))
    throw new Error(`${where} mode must be one of ${MODES.join(", ")}`);
  if (mode === "off") return null;
  const stdin = entry["stdin"] ?? false;
  if (typeof stdin !== "boolean")
    throw new Error(`${where} stdin must be true or false`);
  const onError = entry["on_error"] ?? "allow";
  if (onError !== "allow" && onError !== "deny")
    throw new Error(`${where} on_error must be allow or deny`);
  return {
    name,
    paths,
    command,
    timeoutMs,
    mode: mode as CompiledExternal["mode"],
    ...(stdin ? { stdin: true as const } : {}),
    ...(onError === "deny" ? { onError: "deny" as const } : {}),
  };
}

export function readExternal(value: unknown): CompiledExternal[] {
  if (value === undefined) return [];
  if (!Array.isArray(value))
    throw new Error("[[hooks.guards.external]] must be an array of tables");
  const names = new Set<string>();
  const found: CompiledExternal[] = [];
  for (const item of value) {
    const name = (item as { name?: unknown } | null)?.name;
    if (typeof name === "string" && names.has(name))
      throw new Error(`[[hooks.guards.external]] ${name} is declared twice`);
    if (typeof name === "string") names.add(name);
    const entry = readEntry(item);
    if (entry) found.push(entry);
  }
  return found.sort((a, b) => compareIdentifiers(a.name, b.name));
}
