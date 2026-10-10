import { readFileSync } from "node:fs";

export function processIdentity(pid: number): string {
  if (!Number.isSafeInteger(pid) || pid < 1)
    throw new Error("invalid_process_id");
  const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
  const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
  if (!/^\d+$/.test(fields[19] ?? ""))
    throw new Error("process_identity_unknown");
  return `${pid}:${fields[19]}`;
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
