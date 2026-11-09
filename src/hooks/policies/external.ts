// [[hooks.guards.external]]: a project checker judges each edited file its globs match. Exit 0
// passes, exit 1 with JSON items is a finding, anything else is a checker error: reported once
// per session and refusing only with on_error = "deny".

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

import { globPattern } from "../glob.js";
import type { CompiledExternal } from "../compiled.js";
import type { Decision, EditRequest, HookInput } from "../contract.js";
import { pass, type Policy, type PolicyContext } from "./types.js";

const MAX_LINES = 20;
const MAX_REASON = 2000;
const MAX_OUTPUT = 1 << 20;

export function externalId(entry: CompiledExternal): string {
  return `external.${entry.name}`;
}

function inProject(input: HookInput, path: string): string | null {
  const rest = relative(input.projectRoot, resolve(input.cwd, path));
  if (rest === "" || rest.startsWith("..") || isAbsolute(rest)) return null;
  return rest.split("\\").join("/");
}

// Project-relative paths of the edit that a glob of the entry matches.
export function matchedPaths(
  entry: CompiledExternal,
  input: HookInput,
): string[] {
  const patterns = entry.paths.map((glob) => globPattern(glob));
  const found = new Set<string>();
  for (const path of input.tool?.paths ?? []) {
    const rest = inProject(input, path);
    if (rest !== null && patterns.some((pattern) => pattern.test(rest)))
      found.add(rest);
  }
  return [...found].sort();
}

// The file's text once the edit is applied, or null when the request cannot say.
export function previewText(edit: EditRequest, cwd: string): string | null {
  if (edit.content !== undefined) return edit.content;
  if (!edit.replacements) return null;
  let text: string;
  try {
    text = readFileSync(resolve(cwd, edit.path), "utf8");
  } catch {
    return null;
  }
  for (const change of edit.replacements) {
    if (change.old === "" || !text.includes(change.old)) return null;
    text = change.all
      ? text.split(change.old).join(change.new)
      : text.replace(change.old, () => change.new);
  }
  return text;
}

function itemLine(item: unknown, path: string): string {
  if (typeof item === "string") return `${path}: ${item}`;
  const record =
    item && typeof item === "object" ? (item as Record<string, unknown>) : {};
  const field = (key: string) =>
    typeof record[key] === "string" && record[key] !== ""
      ? (record[key] as string)
      : undefined;
  const message = field("message") ?? JSON.stringify(item);
  const where = field("path") ?? path;
  const line = Number.isSafeInteger(record["line"]) ? `:${record["line"]}` : "";
  const rule = field("rule");
  return `${where}${line}: ${rule ? `${rule}: ` : ""}${message}`;
}

type Checked = { items: string[] } | { error: string };

function check(
  entry: CompiledExternal,
  input: HookInput,
  path: string,
  body: string | undefined,
  timeoutMs: number,
): Checked {
  const placed = entry.command.some((part) => part.includes("{path}"));
  const argv = placed
    ? entry.command.map((part) => part.replaceAll("{path}", path))
    : [...entry.command, path];
  const run = spawnSync(argv[0]!, argv.slice(1), {
    cwd: input.projectRoot,
    env: {
      PATH: process.env["PATH"],
      HOME: process.env["HOME"],
      LANG: "C.UTF-8",
    },
    input: body ?? "",
    encoding: "utf8",
    timeout: timeoutMs,
    killSignal: "SIGKILL",
    maxBuffer: MAX_OUTPUT,
  });
  if (run.error) return { error: `${path}: ${run.error.message}` };
  if (run.status === 0) return { items: [] };
  if (run.status !== 1)
    return { error: `${path}: the checker exited ${run.status ?? run.signal}` };
  let items: unknown;
  try {
    items = (JSON.parse(run.stdout) as Record<string, unknown>)["items"];
  } catch {
    items = undefined;
  }
  if (!Array.isArray(items) || items.length === 0)
    return {
      error: `${path}: the checker exited 1 without JSON holding an items list`,
    };
  return { items: items.map((item) => itemLine(item, path)) };
}

// With stdin the new text is checked before the write when the request says what it is, and
// from disk after the write otherwise; without stdin the checker reads the file after it.
function bodies(
  entry: CompiledExternal,
  input: HookInput,
  paths: readonly string[],
): Map<string, string | undefined> {
  const edit = entry.stdin ? input.tool?.edit : undefined;
  const target = edit ? inProject(input, edit.path) : null;
  const found = new Map<string, string | undefined>();
  for (const path of paths) {
    const previewed = edit !== undefined && path === target;
    if (input.event === "before_tool") {
      const text = previewed ? previewText(edit, input.cwd) : null;
      if (text !== null) found.set(path, text);
      continue;
    }
    if (previewed) continue;
    if (!entry.stdin) {
      found.set(path, undefined);
      continue;
    }
    try {
      found.set(path, readFileSync(resolve(input.projectRoot, path), "utf8"));
    } catch {
      // A file the edit removed has nothing to check.
    }
  }
  return found;
}

// A checker error is said once per session, so a broken checker does not repeat on every edit.
function firstError(
  entry: CompiledExternal,
  input: HookInput,
  ctx: PolicyContext<object>,
): boolean {
  try {
    const record = ctx.store.registry.get(input.session.id);
    const raw = record?.["externalErrors"];
    const seen = Array.isArray(raw) ? (raw as string[]) : [];
    if (seen.includes(entry.name)) return false;
    ctx.store.registry.upsert(input.session.id, {
      externalErrors: [...seen, entry.name],
    });
  } catch {
    // Without a record it is said each time rather than never.
  }
  return true;
}

function evaluate(
  entry: CompiledExternal,
  input: HookInput,
  ctx: PolicyContext<object>,
): Decision {
  const paths = matchedPaths(entry, input);
  if (paths.length === 0) return pass;
  const deadline = Date.now() + entry.timeoutMs;
  const lines: string[] = [];
  const errors: string[] = [];
  for (const [path, body] of bodies(entry, input, paths)) {
    const left = deadline - Date.now();
    const result: Checked =
      left > 0
        ? check(entry, input, path, body, left)
        : { error: `${path}: not checked, ${entry.timeoutMs} ms spent` };
    if ("error" in result) errors.push(result.error);
    else lines.push(...result.items);
  }
  if (lines.length > 0) {
    ctx.log.info("external findings", { items: lines.length });
    const listed = lines.slice(0, MAX_LINES);
    if (lines.length > MAX_LINES)
      listed.push(`and ${lines.length - MAX_LINES} more`);
    const head = `the check ${entry.name} found ${lines.length} problem${lines.length === 1 ? "" : "s"} in the edit; fix ${lines.length === 1 ? "it" : "them"} before going on`;
    return {
      verdict: "deny",
      reason: [head, ...listed].join("\n").slice(0, MAX_REASON),
    };
  }
  if (errors.length === 0) return pass;
  ctx.log.warn("external check failed", {
    guard: entry.name,
    error: errors[0]!.slice(0, 300),
  });
  const reason = [
    `the check ${entry.name} could not answer, so the edit is not known to pass`,
    ...errors.slice(0, MAX_LINES),
  ]
    .join("\n")
    .slice(0, MAX_REASON);
  if (entry.mode === "deny")
    return entry.onError === "deny" ? { verdict: "deny", reason } : pass;
  return firstError(entry, input, ctx) ? { verdict: "deny", reason } : pass;
}

export function externalPolicy(entry: CompiledExternal): Policy<object> {
  return {
    id: externalId(entry),
    events: ["before_tool", "after_tool"],
    tools: ["edit"],
    fail: "open",
    defaultMode: "observe",
    options: () => ({}),
    evaluate: (input, ctx) => evaluate(entry, input, ctx),
  };
}
