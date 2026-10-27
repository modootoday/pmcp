import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, mkdirSync, openSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

import { VERSION } from "../../commands/version.js";
import { missingBinary } from "../../native/binary.js";
import { ptyBinary } from "../../project/host.js";
import type { Call } from "./up.js";

// [host] memory_max, when pmcp.toml does not set it.
export const DEFAULT_MEMORY_MAX = "4G";

export interface DaemonState {
  readonly started: boolean;
  // Which policy the running daemon loaded; anything but host-approval answers nothing approved.
  readonly policy: string;
}

const unitName = (dir: string) =>
  `pmcp-pty-host-${createHash("sha256").update(dir).digest("hex").slice(0, 12)}`;

function binary(env: Readonly<Record<string, string | undefined>>): string {
  const found = ptyBinary(env);
  if (!found)
    throw new Error(missingBinary("pmcp-pty", "PMCP_PTY_BIN", VERSION));
  return found;
}

// A transient scope like the harness uses for its sessions: memory-capped, gone when it ends,
// nothing written under ~/.config/systemd. Its output goes to log, so a failed start can say why.
export function startDaemon(
  socket: string,
  approvedDir: string,
  env: Readonly<Record<string, string | undefined>>,
  log: string,
  memoryMax = DEFAULT_MEMORY_MAX,
): void {
  const bin = binary(env);
  if (spawnSync("systemd-run", ["--version"], { stdio: "ignore" }).status !== 0)
    throw new Error(
      "systemd-run is missing: install systemd and use a user session (loginctl enable-linger is the operator's choice)",
    );
  const argv = [
    "--user",
    "--scope",
    "--collect",
    `--unit=${unitName(approvedDir)}`,
    "-p",
    `MemoryMax=${memoryMax}`,
    bin,
    "daemon",
    "--socket",
    socket,
    "--host",
    approvedDir,
  ];
  mkdirSync(dirname(log), { recursive: true, mode: 0o700 });
  const fd = openSync(log, "a", 0o600);
  try {
    spawn("systemd-run", argv, {
      detached: true,
      stdio: ["ignore", fd, fd],
    }).unref();
  } finally {
    closeSync(fd);
  }
}

async function describe(call: Call): Promise<string | null> {
  try {
    const reply = await call({ op: "describe" }, 3_000);
    const policy = (reply["policy"] ?? {}) as Record<string, unknown>;
    return policy["loaded"] === true ? String(policy["from"]) : "none";
  } catch {
    return null;
  }
}

function tail(log: string | undefined): string {
  if (!log) return "";
  try {
    const text = readFileSync(log, "utf8").trim();
    return text ? `; its output: ${text.slice(-800)}` : "";
  } catch {
    return "";
  }
}

export async function ensureDaemon(
  call: Call,
  start: () => void,
  log?: string,
  waitMs = 5_000,
  sleep = (ms: number) => new Promise((done) => setTimeout(done, ms)),
): Promise<DaemonState> {
  const running = await describe(call);
  if (running !== null) return { started: false, policy: running };
  start();
  for (let waited = 0; waited < waitMs; waited += 100) {
    await sleep(100);
    const policy = await describe(call);
    if (policy !== null) return { started: true, policy };
  }
  throw new Error(
    `pmcp-pty did not answer within ${waitMs} ms after starting${tail(log)}`,
  );
}

// Printed for the operator to install and enable; pmcp never writes or enables a unit.
export function unitText(
  socket: string,
  approvedDir: string,
  env: Readonly<Record<string, string | undefined>>,
  memoryMax = DEFAULT_MEMORY_MAX,
): string {
  return [
    "[Unit]",
    "Description=pmcp-pty host for one pmcp project (operator-approved policy)",
    "",
    "[Service]",
    `ExecStart=${binary(env)} daemon --socket ${socket} --host ${approvedDir}`,
    `MemoryMax=${memoryMax}`,
    "KillMode=control-group",
    "Restart=on-failure",
    "",
    "[Install]",
    "WantedBy=default.target",
    "",
  ].join("\n");
}
