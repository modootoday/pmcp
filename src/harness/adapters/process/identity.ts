import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

// A pid plus its start time, so a reused pid is never taken for the process that held it:
// Linux reads the start tick from /proc, macOS the start second from ps.
export function processIdentity(pid: number): string {
  if (!Number.isSafeInteger(pid) || pid < 1)
    throw new Error("invalid_process_id");
  if (process.platform === "darwin") return `${pid}:${darwinStart(pid)}`;
  const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
  const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
  if (!/^\d+$/.test(fields[19] ?? ""))
    throw new Error("process_identity_unknown");
  return `${pid}:${fields[19]}`;
}

function darwinStart(pid: number): number {
  const run = spawnSync("ps", ["-o", "lstart=", "-p", String(pid)], {
    encoding: "utf8",
  });
  const started = Date.parse(run.stdout.trim());
  if (run.status !== 0 || !Number.isFinite(started)) {
    const gone = new Error("process_gone") as NodeJS.ErrnoException;
    gone.code = "ENOENT";
    throw gone;
  }
  return Math.floor(started / 1000);
}

export function controllerExited(identity: string): boolean {
  if (!/^\d+:\d+$/.test(identity))
    throw new Error("invalid_controller_identity");
  const [pid] = identity.split(":");
  try {
    return processIdentity(Number(pid)) !== identity;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
    throw new Error("controller_liveness_unknown", { cause: error });
  }
}
