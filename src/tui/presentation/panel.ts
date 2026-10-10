import { join } from "node:path";
import { readPrivateJson } from "../../harness/groups/store.js";
import { readView } from "../state/store.js";
import type { PanelRole, Snapshot } from "../contracts.js";
import { dockLines, coordinationLines, mailboxLines } from "./summary.js";
import { observePanel } from "./observation.js";
import { observeMailbox } from "../application/mailbox.js";
import { serializedView } from "../adapters/process/lock.js";

export async function runPanel(file: string, role: PanelRole): Promise<void> {
  async function draw(): Promise<void> {
    if (role === "dock" || role === "management") {
      try {
        serializedView({ action: "check", viewFile: file, input: {} });
      } catch {}
    }
    const { view } = readView(file);
    if (view.state === "closed") return;
    if (role === "history") {
      const history = readPrivateJson(join(view.directory, "history.json")) as {
        sessionId: string;
        content: string;
      };
      const content = history.content.replace(
        /[\x00-\x08\x0b-\x1f\x7f-\x9f]/g,
        "?",
      );
      process.stdout.write(`OWNED HISTORY ${history.sessionId}\n${content}\n`);
      return;
    }
    let lines: string[];
    let observed: Snapshot | undefined;
    try {
      if (role === "mailbox") lines = mailboxLines(await observeMailbox(view));
      else {
        observed = await observePanel(view, role);
        lines = dockLines(observed);
        if (role === "coordination") lines = coordinationLines(observed, view);
        if (role === "management")
          lines.push("", ...coordinationLines(observed, view));
      }
    } catch {
      lines = coordinationLines(undefined, view);
    }
    const width = process.stdout.columns ?? 80;
    const height = process.stdout.rows ?? 24;
    process.stdout.write(
      `\x1b[2J\x1b[H${lines
        .slice(0, height)
        .map((line) => line.slice(0, width))
        .join("\r\n")}`,
    );
  }
  await draw();
  if (role === "history") {
    process.stdin.resume();
    return;
  }
  let stopped = false;
  process.on("SIGTERM", () => {
    stopped = true;
  });
  while (!stopped) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await draw();
  }
}
