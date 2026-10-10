import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { planLayout } from "../../harness/terminal/layout.js";
import type { ViewContext } from "./context.js";
import { releaseControl } from "./control.js";
import { returnToMain } from "./navigation.js";
import { saveView } from "../state/store.js";

export function resizeView({ view, renderer, input }: ViewContext): void {
  renderer.resize(view, planLayout(input.columns!, input.rows!));
}

export async function stopTarget(context: ViewContext): Promise<void> {
  if (context.input.confirmSession !== context.view.target)
    throw new Error("confirm_exact_stop_target");
  await releaseControl(context);
  await context.common.call("session", "stop", {
    sessionId: context.view.target,
  });
}

export async function closeView(context: ViewContext): Promise<void> {
  await returnToMain(context);
  context.renderer.connection.cleanup();
  const history = join(context.view.directory, "history.json");
  if (existsSync(history)) unlinkSync(history);
  context.view.state = "closed";
  saveView(context.file, context.view);
}
