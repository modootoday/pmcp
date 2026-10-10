import type { Receipt } from "../../harness/contracts.js";
import { openView } from "./context.js";

export async function startViewWorker(
  file: string,
  runtime: string,
  memoryMb?: number,
): Promise<Receipt> {
  const { view, common } = openView(file);
  if (view.state !== "open") throw new Error("view_closed");
  const observed = await common.snapshot();
  if (observed.group.state !== "ready") throw new Error("group_not_ready");
  const main = observed.sessions.find(
    (session) => session.id === view.mainId && session.role === "main",
  );
  if (!main?.alive) throw new Error("startup_main_unavailable");
  return common.call("session", "start", {
    input: { role: "worker", runtime, memoryMb: memoryMb ?? main.memoryMb },
  });
}
