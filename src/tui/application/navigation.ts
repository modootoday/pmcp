import type { ViewContext } from "./context.js";
import type { Snapshot } from "../contracts.js";
import { releaseControl } from "./control.js";

export async function returnToMain(context: ViewContext): Promise<void> {
  const { view, renderer } = context;
  await releaseControl(context);
  view.target = view.mainId;
  renderer.select(view, true);
  renderer.closeObserver(view);
}

export async function observeWorker(context: ViewContext): Promise<void> {
  const { view, renderer, common, input } = context;
  const observed = await common.call("session", "list");
  const workers = (observed.sessions as Snapshot["sessions"]).filter(
    (session) => session.role === "worker",
  );
  const index = input.index ?? 1;
  if (!Number.isSafeInteger(index) || index < 1 || index > workers.length)
    throw new Error("worker_index_unavailable");
  const worker = workers[index - 1]!;
  if (!worker.alive) throw new Error("worker_unavailable");
  await returnToMain(context);
  renderer.worker(view, renderer.attachment(worker.id));
  view.target = worker.id;
}
