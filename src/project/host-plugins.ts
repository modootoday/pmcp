import { ConfigError } from "../config.js";

// [host.browser] and [host.desktop]: what widens pmcp-browser and pmcp-desktop beyond their
// defaults (public sites only; no apps). Like answers, they act only from the approved copy.

export interface HostBrowser {
  readonly allowPrivate: readonly string[];
}

export interface HostLaunch {
  readonly name: string;
  readonly argv: readonly string[];
}

export interface HostDesktop {
  readonly launch: readonly HostLaunch[];
}

const HOST_PORT = /^(\[[0-9a-f:]+\]|[a-z0-9.-]+):(\*|[0-9]{1,5})$/iu;
const NAME = /^[a-z0-9][a-z0-9-]{0,47}$/u;
// The desktop could type into a browser's address bar, so browsers go through pmcp-browser only.
const BROWSER =
  /(^|\/)(chrom[a-z-]*|google-chrome[a-z-]*|firefox[a-z-]*|epiphany|brave[a-z-]*|microsoft-edge[a-z-]*|opera|vivaldi|x-www-browser)$/u;

type Table = Record<string, unknown>;

function fail(path: string, message: string): never {
  throw new ConfigError(path, message);
}

function table(path: string, where: string, value: unknown): Table {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    fail(path, `${where} must be a table`);
  return value as Table;
}

function strings(path: string, where: string, value: unknown): string[] {
  if (
    !Array.isArray(value) ||
    !value.every((v) => typeof v === "string" && v !== "")
  )
    fail(path, `${where} must be a list of non-empty strings`);
  return value as string[];
}

export function readHostBrowser(path: string, raw: unknown): HostBrowser {
  if (raw === undefined) return { allowPrivate: [] };
  const t = table(path, "[host.browser]", raw);
  for (const key of Object.keys(t))
    if (key !== "allow_private")
      fail(path, `[host.browser] unknown key ${key}`);
  const list =
    t["allow_private"] === undefined
      ? []
      : strings(path, "[host.browser] allow_private", t["allow_private"]);
  for (const entry of list)
    if (!HOST_PORT.test(entry))
      fail(
        path,
        `[host.browser] allow_private ${entry}: use host:port or host:*`,
      );
  return { allowPrivate: [...new Set(list)] };
}

export function readHostDesktop(path: string, raw: unknown): HostDesktop {
  if (raw === undefined) return { launch: [] };
  const t = table(path, "[host.desktop]", raw);
  for (const key of Object.keys(t))
    if (key !== "launch") fail(path, `[host.desktop] unknown key ${key}`);
  const value = t["launch"] ?? [];
  if (!Array.isArray(value))
    fail(path, "[[host.desktop.launch]] must be an array of tables");
  const seen = new Set<string>();
  const launch = value.map((entry, i): HostLaunch => {
    const where = `[[host.desktop.launch]] #${i + 1}`;
    const e = table(path, where, entry);
    for (const key of Object.keys(e))
      if (key !== "name" && key !== "argv")
        fail(path, `${where} unknown key ${key}`);
    const name = e["name"];
    if (typeof name !== "string" || !NAME.test(name))
      fail(path, `${where} name: use lowercase, digits and -`);
    if (seen.has(name)) fail(path, `${where} name ${name} is used twice`);
    seen.add(name);
    const argv = strings(path, `${where} argv`, e["argv"]);
    if (argv.length === 0) fail(path, `${where} argv must not be empty`);
    if (BROWSER.test(argv[0]!))
      fail(
        path,
        `${where} ${argv[0]}: browsers are never launched on the desktop; use pmcp-browser`,
      );
    return { name, argv };
  });
  return { launch };
}
