import type { View, ViewInput } from "../contracts.js";
import { readView } from "../state/store.js";
import { TmuxView } from "../adapters/tmux/view.js";
import { CommonHarness } from "./common.js";

export interface ViewContext {
  file: string;
  view: View;
  renderer: TmuxView;
  common: CommonHarness;
  input: ViewInput;
}

export function openView(path: string, input: ViewInput = {}): ViewContext {
  const { view, file } = readView(path);
  return {
    view,
    file,
    renderer: new TmuxView(view, file),
    common: new CommonHarness(view),
    input,
  };
}

export function targetPane(context: ViewContext): string {
  const pane =
    context.view.target === context.view.mainId
      ? context.view.mainPane
      : context.view.workerPane;
  if (!pane) throw new Error("target_not_native");
  return pane;
}

export async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("writer_not_ready");
}
