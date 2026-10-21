import { existsSync, readFileSync, realpathSync } from "node:fs";
import { delimiter, join } from "node:path";

// The pmcp CLI that projects this checkout: its own install, else the one that last projected
// it (projector.json in the state directory). PATH is not trusted for this, because an older
// global CLI may not understand the project's configuration. Hook-safe: reads files only.
const PROJECTOR_FILE = "projector.json";

function readJson(path: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function localCli(root: string): string | null {
  const own = join(root, "node_modules/@modootoday/pmcp/dist/cli.js");
  if (existsSync(own)) return own;
  try {
    const target = realpathSync(join(root, "node_modules/.bin/pmcp"));
    return /\.[cm]?js$/u.test(target) ? target : null;
  } catch {
    return null;
  }
}

export function recordedCli(root: string, stateDir: string): string | null {
  const known = readJson(join(stateDir, PROJECTOR_FILE));
  let checkout: string;
  try {
    checkout = realpathSync(root);
  } catch {
    return null;
  }
  const entry = known?.[checkout] as { cli?: unknown } | undefined;
  return typeof entry?.cli === "string" ? entry.cli : null;
}

export function projectingCli(root: string, stateDir: string): string | null {
  const cli = localCli(root) ?? recordedCli(root, stateDir);
  return cli && existsSync(cli) ? cli : null;
}

// The pmcp executable a shell would run from PATH, resolved through links.
export function pathPmcp(path: string | undefined): string | null {
  for (const dir of (path ?? "").split(delimiter).filter(Boolean)) {
    try {
      return realpathSync(join(dir, "pmcp"));
    } catch {
      continue;
    }
  }
  return null;
}

const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

// How a session should invoke pmcp for this project: plain pmcp when PATH already runs the
// projecting CLI, else that CLI through node (live, 2026-10-20: PATH pmcp 0.16.1 had no mailbox).
export function pmcpCommand(
  root: string,
  stateDir: string,
  path: string | undefined,
): string {
  const cli = projectingCli(root, stateDir);
  if (!cli) return "pmcp";
  let real = cli;
  try {
    real = realpathSync(cli);
  } catch {
    return "pmcp";
  }
  return pathPmcp(path) === real ? "pmcp" : `node ${quote(real)}`;
}
