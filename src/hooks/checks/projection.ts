import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { localCli, recordedCli } from "../../sessions/projector-cli.js";

export type ProjectionState = "clean" | "drift" | "unavailable";
export type Projector = { readonly cli: string } | { readonly missing: string };

const LOCK_VERSION_KEY = "pmcp_version";
// Recognize only drift and conflict lines so an incompatible CLI is not reported as projection drift.
const PROBLEM = /^x (?:drift|stale|undeclared|dead glob|conflict): /mu;

function run(command: readonly string[], root: string, deadline: number) {
  return spawnSync(command[0]!, command.slice(1), {
    cwd: root,
    encoding: "utf8",
    timeout: Math.max(1, deadline - Date.now()),
    killSignal: "SIGKILL",
    maxBuffer: 1024 * 1024,
    shell: false,
  });
}

function readJson(path: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

// Avoid PATH because an older global CLI may not understand the project's configuration.
export function findProjector(
  root: string,
  stateDir: string,
  deadline: number,
): Projector {
  const cli = localCli(root) ?? recordedCli(root, stateDir);
  if (!cli || !existsSync(cli))
    return { missing: cli ?? "no local or recorded pmcp" };
  const expected = readJson(join(root, "pmcp.lock"))?.[LOCK_VERSION_KEY];
  const answer = run([process.execPath, cli, "--version"], root, deadline);
  if (answer.error || answer.stdout.trim() !== expected)
    return { missing: cli };
  return { cli };
}

export function projectionState(
  root: string,
  cli: string,
  deadline: number,
): ProjectionState {
  const result = run(
    [process.execPath, cli, "project", "--check"],
    root,
    deadline,
  );
  if (result.error) return "unavailable";
  if (result.status === 0) return "clean";
  return PROBLEM.test(`${result.stdout}${result.stderr}`)
    ? "drift"
    : "unavailable";
}
