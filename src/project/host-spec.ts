import { isAbsolute, normalize } from "node:path";

import { ConfigError } from "../config.js";
import { envNames } from "../native/env-names.js";
import {
  readHostBrowser,
  readHostDesktop,
  type HostBrowser,
  type HostDesktop,
} from "./host-plugins.js";

// [host]: the sessions pmcp-pty runs for this project and what the operator lets it answer.
// pmcp project writes it out; nothing takes effect until the operator approves the result.

export const HOST_RUNTIMES = [
  "claude",
  "codex",
  "gemini",
  "agy",
  "grok",
  "opencode",
] as const;
export type HostRuntime = (typeof HOST_RUNTIMES)[number];

export interface HostSession {
  readonly name: string;
  readonly runtime: HostRuntime;
  readonly cwd: string;
  readonly argv: readonly string[];
  readonly labels: Readonly<Record<string, string>>;
  readonly restart: "no" | "on-exit";
  readonly maxRestarts: number;
  // Names whose values host up passes from its own environment; never a value.
  readonly env: readonly string[];
}

export interface HostAnswer {
  readonly runtime: HostRuntime;
  readonly dialog: string;
  readonly options: readonly string[];
}

export interface HostSpec {
  readonly sessions: readonly HostSession[];
  readonly answers: readonly HostAnswer[];
  readonly mcpWrite: boolean;
  readonly roots: readonly string[];
  readonly browser: HostBrowser;
  readonly desktop: HostDesktop;
}

const NAME = /^[a-z0-9][a-z0-9-]{0,47}$/u;
const LABEL = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
const CONTROL = /[\u0000-\u001f\u007f]/u;

type Table = Record<string, unknown>;

function fail(path: string, message: string): never {
  throw new ConfigError(path, message);
}

function table(path: string, where: string, value: unknown): Table {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    fail(path, `${where} must be a table`);
  return value as Table;
}

function only(path: string, where: string, t: Table, keys: readonly string[]) {
  for (const key of Object.keys(t))
    if (!keys.includes(key)) fail(path, `${where} unknown key ${key}`);
}

function text(path: string, where: string, value: unknown): string {
  if (typeof value !== "string" || value === "" || CONTROL.test(value))
    fail(
      path,
      `${where} must be a non-empty string without control characters`,
    );
  return value;
}

function texts(path: string, where: string, value: unknown): string[] {
  if (!Array.isArray(value)) fail(path, `${where} must be a list of strings`);
  return value.map((v, i) => text(path, `${where}[${i}]`, v));
}

function runtime(path: string, where: string, value: unknown): HostRuntime {
  const name = text(path, where, value);
  if (!(HOST_RUNTIMES as readonly string[]).includes(name))
    fail(path, `${where} must be one of ${HOST_RUNTIMES.join(", ")}`);
  return name as HostRuntime;
}

// A project-relative directory, so the projection never holds a host path.
function relative(path: string, where: string, value: unknown): string {
  const dir = normalize(text(path, where, value));
  if (isAbsolute(dir) || dir === ".." || dir.startsWith("../"))
    fail(path, `${where} must be a directory inside the project`);
  return dir.replace(/\/$/u, "");
}

const under = (dir: string, root: string) =>
  root === "." || dir === root || dir.startsWith(`${root}/`);

// Login, auth and trust prompts belong to the person at the keyboard; pmcp-pty refuses them
// too, but a policy that lists one is a mistake worth stopping at parse time.
export function neverAnswered(dialog: string): boolean {
  return (
    dialog.startsWith("auth-") ||
    dialog.includes("trust") ||
    dialog === "hooks-review"
  );
}

function answer(path: string, i: number, value: unknown): HostAnswer {
  const where = `[[host.answers]] #${i + 1}`;
  const t = table(path, where, value);
  only(path, where, t, ["runtime", "dialog", "options"]);
  const dialog = text(path, `${where} dialog`, t["dialog"]);
  if (neverAnswered(dialog))
    fail(path, `${where} dialog ${dialog} is never answered by pmcp-pty`);
  const options = texts(path, `${where} options`, t["options"]);
  if (options.length === 0) fail(path, `${where} options must not be empty`);
  return {
    runtime: runtime(path, `${where} runtime`, t["runtime"]),
    dialog,
    options,
  };
}

function labels(
  path: string,
  where: string,
  value: unknown,
): Record<string, string> {
  if (value === undefined) return {};
  const t = table(path, where, value);
  const out: Record<string, string> = {};
  for (const [key, v] of Object.entries(t)) {
    if (!LABEL.test(key) || key.startsWith("pmcp."))
      fail(
        path,
        `${where} label ${key}: lowercase name, not starting with pmcp.`,
      );
    out[key] = text(path, `${where}.${key}`, v);
  }
  return out;
}

function session(
  path: string,
  i: number,
  value: unknown,
  roots: readonly string[],
): HostSession {
  const where = `[[host.sessions]] #${i + 1}`;
  const t = table(path, where, value);
  only(path, where, t, [
    "name",
    "runtime",
    "cwd",
    "argv",
    "labels",
    "restart",
    "max_restarts",
    "env",
  ]);
  const name = text(path, `${where} name`, t["name"]);
  if (!NAME.test(name))
    fail(path, `${where} name ${name}: use lowercase, digits and -`);
  const kind = runtime(path, `${where} runtime`, t["runtime"]);
  const cwd =
    t["cwd"] === undefined ? "." : relative(path, `${where} cwd`, t["cwd"]);
  if (!roots.some((root) => under(cwd, root)))
    fail(path, `${where} cwd ${cwd} is not under [host] roots`);
  const argv =
    t["argv"] === undefined ? [kind] : texts(path, `${where} argv`, t["argv"]);
  if (argv.length === 0) fail(path, `${where} argv must not be empty`);
  const restart = t["restart"] ?? "no";
  if (restart !== "no" && restart !== "on-exit")
    fail(path, `${where} restart must be "no" or "on-exit"`);
  const max = t["max_restarts"] ?? 3;
  if (typeof max !== "number" || !Number.isInteger(max) || max < 0 || max > 100)
    fail(path, `${where} max_restarts must be an integer from 0 to 100`);
  return {
    name,
    runtime: kind,
    cwd,
    argv,
    labels: labels(path, `${where} labels`, t["labels"]),
    restart,
    maxRestarts: max,
    env: names(path, `${where} env`, t["env"]),
  };
}

function names(path: string, where: string, value: unknown): string[] {
  try {
    return envNames(value, where);
  } catch (error) {
    return fail(path, (error as Error).message);
  }
}

export function readHost(path: string, raw: unknown): HostSpec | undefined {
  if (raw === undefined) return undefined;
  const root = table(path, "[host]", raw);
  only(path, "[host]", root, [
    "sessions",
    "answers",
    "mcp_write",
    "roots",
    "browser",
    "desktop",
  ]);
  const roots =
    root["roots"] === undefined
      ? ["."]
      : texts(path, "[host] roots", root["roots"]).map((r, i) =>
          relative(path, `[host] roots[${i}]`, r),
        );
  const mcpWrite = root["mcp_write"] ?? false;
  if (typeof mcpWrite !== "boolean")
    fail(path, "[host] mcp_write must be true or false");
  const list = (key: string) => {
    const value = root[key];
    if (value === undefined) return [];
    if (!Array.isArray(value))
      fail(path, `[host] ${key} must be an array of tables`);
    return value;
  };
  const sessions = list("sessions").map((s, i) => session(path, i, s, roots));
  const names = new Set<string>();
  for (const s of sessions) {
    if (names.has(s.name))
      fail(path, `[[host.sessions]] name ${s.name} is used twice`);
    names.add(s.name);
  }
  const answers = list("answers").map((a, i) => answer(path, i, a));
  const browser = readHostBrowser(path, root["browser"]);
  const desktop = readHostDesktop(path, root["desktop"]);
  return { sessions, answers, mcpWrite, roots, browser, desktop };
}
