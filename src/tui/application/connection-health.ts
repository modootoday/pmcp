import type { AttachedClient } from "../../harness/adapters/tmux/clients.js";
import type { ViewContext } from "./context.js";
import { targetPane } from "./context.js";
import { setPhase } from "./feedback.js";

export async function checkControl(context: ViewContext): Promise<void> {
  const { view, common, renderer, file } = context;
  if (view.phase !== "controlled") return;
  const pane = targetPane(context);
  try {
    const snapshot = await common.snapshot();
    const lease = snapshot.control.find(
      (entry) =>
        entry.sessionId === view.target &&
        entry.controller === `pmcp-tui-${view.owner}`,
    );
    if (!lease || Date.parse(lease.expiresAt) <= Date.now())
      throw new Error("control_connection_lost");
    const attached = await common.call("attach", "inspect", {
      sessionId: view.target,
    });
    const tty = renderer.tty(pane);
    if (
      !(attached.clients as AttachedClient[]).some(
        (client) => !client.readOnly && client.tty === tty,
      )
    )
      throw new Error("control_connection_lost");
  } catch (error) {
    renderer.input(pane, false);
    setPhase(file, view, "uncertain");
    throw error;
  }
}
