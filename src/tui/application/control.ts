import type { AttachedClient } from "../../harness/adapters/tmux/clients.js";
import type { ViewContext } from "./context.js";
import { targetPane, waitFor } from "./context.js";
import { setPhase } from "./feedback.js";
import { saveView } from "../state/store.js";

function phase(
  context: ViewContext,
  value: Parameters<typeof setPhase>[2],
): void {
  setPhase(context.file, context.view, value);
  context.renderer.status(context.view);
}

export async function releaseControl(context: ViewContext): Promise<void> {
  const { view, renderer, common, file } = context;
  const pane = targetPane(context);
  renderer.input(pane, false);
  if (!view.leaseFile) {
    phase(context, "read-only");
    return;
  }
  phase(context, "releasing");
  renderer.replace(pane, renderer.attachment(view.target));
  try {
    await waitFor(async () => {
      try {
        await common.call("control", "release", { leaseFile: view.leaseFile });
      } catch (error) {
        if (
          !(error instanceof Error) ||
          ![
            "native_writer_active",
            "stale_control",
            "group_control_busy",
          ].includes(error.message)
        )
          throw error;
      }
      const recovery = await common.call("recovery", "inspect");
      const controls = recovery.control as {
        sessionId: string;
        controller: string;
      }[];
      return !controls.some(
        (lease) =>
          lease.controller === `pmcp-tui-${view.owner}` &&
          lease.sessionId === view.target,
      );
    }, 5000);
    delete view.leaseFile;
    phase(context, "read-only");
  } catch (error) {
    phase(context, "uncertain");
    throw error;
  } finally {
    saveView(file, view);
  }
}

export async function acquireControl(context: ViewContext): Promise<void> {
  const { view, renderer, common, file } = context;
  if (view.leaseFile) throw new Error("view_already_controls_target");
  if (view.observerRole && view.observerRole !== "native")
    throw new Error("target_not_native");
  const pane = targetPane(context);
  renderer.input(pane, false);
  phase(context, "acquiring");
  try {
    const acquired = await common.call("control", "acquire", {
      sessionId: view.target,
      controller: `pmcp-tui-${view.owner}`,
      mode: "native",
    });
    if (typeof acquired.leaseFile !== "string")
      throw new Error("control_receipt_invalid");
    view.leaseFile = acquired.leaseFile;
    phase(context, "connecting");
    renderer.replace(pane, renderer.attachment(view.target, view.leaseFile));
    renderer.input(pane, false);
    const tty = renderer.tty(pane);
    await waitFor(async () => {
      const observed = await common.call("attach", "inspect", {
        sessionId: view.target,
      });
      const clients = observed.clients as AttachedClient[];
      return clients.some((client) => client.tty === tty && !client.readOnly);
    }, 5000);
    renderer.select(view, view.target === view.mainId);
    renderer.input(pane, true);
    phase(context, "controlled");
  } catch (error) {
    renderer.input(pane, false);
    if (view.leaseFile) {
      try {
        await releaseControl(context);
      } catch {
        phase(context, "uncertain");
      }
    }
    if (
      !view.leaseFile &&
      view.phase !== "read-only" &&
      view.phase !== "uncertain"
    )
      phase(context, "read-only");
    throw error;
  } finally {
    saveView(file, view);
  }
}
