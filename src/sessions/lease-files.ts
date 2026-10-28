import { dirname, isAbsolute, join } from "node:path";

import { expandPath } from "./paths.js";

// A lease kept outside the state dir, where any tool coordinating the same paths can read it
// (docs/git-workflow.md, Shared file formats): [sessions.leases.<name>] file, and events for
// the delivery records. ${gate_dir}/ means the directory of the gate tree, so both follow a
// [git.mainline.gate] tree_env override. [sessions] pause_file takes the same path forms, so
// another tool that pauses the same work can keep the pause where it already reads it.

export interface LeaseFiles {
  readonly file?: string;
  readonly events?: string;
}

export interface GateLocation {
  readonly tree?: string;
  readonly treeEnv?: string;
}

const GATE_DIR = "${gate_dir}/";

type Env = Readonly<Record<string, string | undefined>>;

function record(value: unknown, where: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${where} must be a table`);
  return value as Record<string, unknown>;
}

function setting(value: unknown, where: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value === "")
    throw new Error(`${where} must be a path`);
  if (value.startsWith(GATE_DIR)) return value;
  const home =
    value === "~" || value.startsWith("~/") || value.startsWith("$HOME/");
  const path = home ? expandPath("/", value) : value;
  if (!isAbsolute(path))
    throw new Error(
      `${where} must be absolute, start with ~/ or start with \${gate_dir}/`,
    );
  return path;
}

export function readLeaseFiles(leases: unknown): Record<string, LeaseFiles> {
  if (leases === undefined) return {};
  const out: Record<string, LeaseFiles> = {};
  for (const [name, raw] of Object.entries(
    record(leases, "[sessions.leases]"),
  )) {
    const where = `[sessions.leases.${name}]`;
    const table = record(raw, where);
    const file = setting(table["file"], `${where} file`);
    const events = setting(table["events"], `${where} events`);
    if (file || events)
      out[name] = { ...(file ? { file } : {}), ...(events ? { events } : {}) };
  }
  return out;
}

export function readPauseFile(value: unknown): string | undefined {
  return setting(value, "[sessions] pause_file");
}

// [git.mainline.gate] tree and tree_env as written; resolved per run, since tree_env is read
// from the environment of whichever process opens the store.
export function readGateLocation(git: unknown): GateLocation {
  if (git === null || typeof git !== "object") return {};
  const mainline = (git as Record<string, unknown>)["mainline"];
  if (mainline === null || typeof mainline !== "object") return {};
  const gate = (mainline as Record<string, unknown>)["gate"];
  if (gate === null || typeof gate !== "object") return {};
  const { tree, tree_env: treeEnv } = gate as Record<string, unknown>;
  return {
    ...(typeof tree === "string" ? { tree } : {}),
    ...(typeof treeEnv === "string" ? { treeEnv } : {}),
  };
}

export function gateTree(
  root: string,
  stateDir: string,
  gate: GateLocation,
  env: Env,
): string {
  const override = gate.treeEnv ? env[gate.treeEnv] : undefined;
  if (override) return override;
  return gate.tree
    ? expandPath(root, gate.tree)
    : join(stateDir, "gate", "tree");
}

function atGateDir(path: string, gateDir: string): string {
  return path.startsWith(GATE_DIR)
    ? join(gateDir, path.slice(GATE_DIR.length))
    : path;
}

export function resolvePauseFile(
  file: string | undefined,
  gateDir: string,
): string | undefined {
  return file === undefined ? undefined : atGateDir(file, gateDir);
}

export function resolveLeaseFiles(
  files: Readonly<Record<string, LeaseFiles>> | undefined,
  gateDir: string,
): Record<string, LeaseFiles> {
  const resolve = (path: string | undefined) =>
    path === undefined ? undefined : atGateDir(path, gateDir);
  return Object.fromEntries(
    Object.entries(files ?? {}).map(([name, f]) => {
      const file = resolve(f.file);
      const events = resolve(f.events);
      return [
        name,
        { ...(file ? { file } : {}), ...(events ? { events } : {}) },
      ];
    }),
  );
}

export function leaseFilesFor(
  root: string,
  stateDir: string,
  files: Readonly<Record<string, LeaseFiles>> | undefined,
  gate: GateLocation | undefined,
  env: Env,
): Record<string, LeaseFiles> {
  if (!files || Object.keys(files).length === 0) return {};
  return resolveLeaseFiles(
    files,
    dirname(gateTree(root, stateDir, gate ?? {}, env)),
  );
}

export function pauseFileFor(
  root: string,
  stateDir: string,
  file: string | undefined,
  gate: GateLocation | undefined,
  env: Env,
): string | undefined {
  if (!file) return undefined;
  return resolvePauseFile(
    file,
    dirname(gateTree(root, stateDir, gate ?? {}, env)),
  );
}
