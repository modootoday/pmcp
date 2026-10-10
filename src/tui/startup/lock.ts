import { spawnSync } from "node:child_process";
import { closeSync, constants, fstatSync, openSync } from "node:fs";
import { runtime } from "../adapters/process/runtime.js";
import { ensureStartupDirectory, startupFile } from "./state.js";
import { startupSettings, type StartupRequest } from "./config.js";
import type { Receipt } from "../../harness/contracts.js";

export function serializedStartup(request: StartupRequest): Receipt {
  const settings = startupSettings(request);
  const file = startupFile(settings.projectRoot);
  ensureStartupDirectory(file);
  const lock = `${file}.lock`;
  const descriptor = openSync(
    lock,
    constants.O_CREAT | constants.O_WRONLY | constants.O_NOFOLLOW,
    0o600,
  );
  try {
    const stat = fstatSync(descriptor);
    if (
      !stat.isFile() ||
      stat.uid !== process.getuid?.() ||
      (stat.mode & 0o077) !== 0
    )
      throw new Error("unsafe_startup_lock");
  } finally {
    closeSync(descriptor);
  }
  const helpers = runtime();
  const encoded = Buffer.from(JSON.stringify(request)).toString("base64url");
  const child = spawnSync(
    "flock",
    [
      "--wait",
      "10",
      "--close",
      "--conflict-exit-code",
      "73",
      lock,
      helpers.node,
      helpers.worker,
      "startup",
      encoded,
    ],
    {
      encoding: "utf8",
      timeout: 60_000,
      maxBuffer: 256 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        PMCP_TUI_COLUMNS: String(process.stdout.columns),
        PMCP_TUI_ROWS: String(process.stdout.rows),
      },
    },
  );
  if (child.status === 73) throw new Error("startup_busy");
  if (child.error || !child.stdout.trim())
    throw new Error("startup_requires_recovery");
  return JSON.parse(child.stdout) as Receipt;
}
