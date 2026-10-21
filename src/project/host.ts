import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { nativeBinary } from "../native/binary.js";
import { readLock } from "./apply/lock.js";
import type { Finding } from "./doctor/types.js";
import type { HostSpec } from "./host-spec.js";
import type { Output } from "./outputs.js";
import type { ProjectSpec } from "./spec.js";

export { readHost, type HostSpec } from "./host-spec.js";

export const HOST_DIRECTORY = ".agents/pmcp-pty";
export const HOST_MANIFEST = `${HOST_DIRECTORY}/host.json`;
export const HOST_POLICY = `${HOST_DIRECTORY}/policy.json`;

// The policy keeps pmcp-pty's own field names (allow, profile, dialog, options, mcp_write), and
// the plugins' (browser.allow_private, desktop.launch), so each reads an approved copy as is.
// The plugin keys appear only when set, so an existing approval stays valid without them.
export function hostPolicy(host: HostSpec): unknown {
  const browser = host.browser.allowPrivate;
  const launch = host.desktop.launch;
  return {
    version: 1,
    mcp_write: host.mcpWrite,
    roots: host.roots,
    allow: host.answers.map((a) => ({
      profile: a.runtime,
      dialog: a.dialog,
      options: a.options,
    })),
    ...(browser.length > 0 ? { browser: { allow_private: browser } } : {}),
    ...(launch.length > 0 ? { desktop: { launch } } : {}),
  };
}

export function hostManifest(host: HostSpec): unknown {
  return {
    version: 1,
    sessions: host.sessions.map((s) => ({
      name: s.name,
      profile: s.runtime,
      cwd: s.cwd,
      argv: s.argv,
      labels: { ...s.labels, "pmcp.host": s.name },
      restart: s.restart,
      max_restarts: s.maxRestarts,
      delivery_setup: true,
    })),
  };
}

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

export function hostOutputs(spec: ProjectSpec): Output[] {
  if (!spec.host) return [];
  return [
    {
      kind: "file",
      path: HOST_MANIFEST,
      content: json(hostManifest(spec.host)),
    },
    { kind: "file", path: HOST_POLICY, content: json(hostPolicy(spec.host)) },
  ];
}

// PMCP_PTY_BIN when set, else the platform package, else pmcp-pty on PATH.
export function ptyBinary(
  env: Readonly<Record<string, string | undefined>>,
): string | null {
  return nativeBinary("pmcp-pty", "PMCP_PTY_BIN", env);
}

export function ptyBinaryDoctor(
  env: Readonly<Record<string, string | undefined>>,
): Finding {
  const found = ptyBinary(env);
  return found
    ? { tool: "project", check: "pmcp-pty binary", status: "ok", detail: found }
    : {
        tool: "project",
        check: "pmcp-pty binary",
        status: "warn",
        detail: "pmcp-pty not found; set PMCP_PTY_BIN or put it on PATH",
      };
}

const sha256 = (text: string) =>
  createHash("sha256").update(text).digest("hex");

// On disk and as pmcp.lock pinned it; whether the operator approved it is the approval's row.
export function hostDoctor(spec: ProjectSpec): Finding[] {
  if (!spec.host) return [];
  const lock = new Map(readLock(spec.root).map((e) => [e.path, e]));
  const bad = [HOST_MANIFEST, HOST_POLICY].filter((path) => {
    const file = join(spec.root, path);
    if (!existsSync(file)) return true;
    const entry = lock.get(path) as { sha256?: string } | undefined;
    return entry?.sha256 !== sha256(readFileSync(file, "utf8"));
  });
  const { sessions, answers, mcpWrite } = spec.host;
  const summary = `${sessions.length} session(s), ${answers.length} answer rule(s), mcp_write ${mcpWrite}`;
  return [
    bad.length === 0
      ? {
          tool: "project",
          check: "pmcp-pty host projected",
          status: "ok",
          detail: summary,
        }
      : {
          tool: "project",
          check: "pmcp-pty host projected",
          status: "fail",
          detail: `run pmcp project: ${bad.join(", ")}`,
        },
  ];
}
