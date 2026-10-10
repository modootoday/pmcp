import { join } from "node:path";
import { privateJson } from "../../harness/groups/store.js";
import { saveView } from "../state/store.js";
import { releaseControl } from "./control.js";
import { waitFor, type ViewContext } from "./context.js";

export async function observeHistory(context: ViewContext): Promise<void> {
  const { view, renderer, common, file } = context;
  await releaseControl(context);
  const history = await common.call("session", "read", {
    sessionId: view.target,
    input: { lines: 2000, maxBytes: 65536 },
  });
  privateJson(join(view.directory, "history.json"), {
    sessionId: view.target,
    content: history.content,
    truncated: history.truncated,
  });
  renderer.worker(view, renderer.panel("history"), "history");
  saveView(file, view);
  await waitFor(
    () => renderer.capture(view.workerPane!).includes("OWNED HISTORY"),
    5000,
  );
  renderer.copy(view.workerPane!);
}
