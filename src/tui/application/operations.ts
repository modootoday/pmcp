import type { Action, ViewInput } from "../contracts.js";
import { openView, type ViewContext } from "./context.js";
import { dismissFailure, saveView } from "../state/store.js";
import { acquireControl, releaseControl } from "./control.js";
import { returnToMain, observeWorker } from "./navigation.js";
import { observeHistory } from "./history.js";
import { observeInbox } from "./mailbox.js";
import { resizeView, stopTarget, closeView } from "./lifecycle.js";
import { describeFailure } from "./feedback.js";
import { checkControl } from "./connection-health.js";

const handlers: Partial<
  Record<Action, (context: ViewContext) => void | Promise<void>>
> = {
  resize: resizeView,
  main: returnToMain,
  observe: observeWorker,
  control: acquireControl,
  release: releaseControl,
  history: observeHistory,
  mailbox: observeInbox,
  stop: stopTarget,
  detach: returnToMain,
  disconnect: returnToMain,
  open: returnToMain,
  close: closeView,
  check: checkControl,
  dismiss: ({ view, file }) => dismissFailure(file, view),
  management: async (context) => {
    await releaseControl(context);
    if (context.view.managementWindow) {
      context.renderer.connection.command([
        "select-window",
        "-t",
        context.view.managementWindow,
      ]);
      return;
    }
    context.renderer.select(context.view, true);
  },
};

export async function operate(
  action: Action,
  path: string,
  input: ViewInput = {},
) {
  const context = openView(path, input);
  const { view, file, renderer, common } = context;
  if (action === "inspect")
    return {
      schemaVersion: 1,
      ok: true,
      view,
      snapshot: await common.snapshot(),
    };
  if (action === "disconnect" && view.state === "closed")
    return { schemaVersion: 1, ok: true, preserved: true };
  try {
    if (view.state !== "open") throw new Error("view_closed");
    const handler = handlers[action];
    if (!handler) throw new Error("unsupported_view_operation");
    if (action === "open" && renderer.clients())
      throw new Error("view_client_already_active");
    if (action === "disconnect" && renderer.clients())
      return { schemaVersion: 1, ok: true, preserved: true };
    if (action !== "check")
      view.lastAction = {
        action,
        status: "running",
        at: new Date().toISOString(),
      };
    saveView(file, view);
    await handler(context);
    if (action !== "check")
      view.lastAction = {
        action,
        status: "completed",
        at: new Date().toISOString(),
      };
    saveView(file, view);
    if (action === "close")
      return {
        schemaVersion: 1,
        ok: true,
        closed: true,
        runtimeStopRequested: false,
      };
    renderer.status(view);
    if (action === "detach") renderer.detach(view);
    return {
      schemaVersion: 1,
      ok: true,
      viewFile: file,
      target: view.target,
      readOnly: view.phase !== "controlled",
      phase: view.phase,
      runtimeStopRequested: action === "stop",
    };
  } catch (error) {
    view.failure = describeFailure(action, error);
    view.lastAction = {
      action,
      status: "failed",
      at: new Date().toISOString(),
    };
    saveView(file, view);
    if (view.state === "open") {
      try {
        renderer.status(view);
      } catch {}
    }
    return {
      schemaVersion: 1,
      ok: false,
      error: view.failure.code,
      hint: view.failure.hint,
      viewFile: file,
      inputReplayed: false,
    };
  }
}
