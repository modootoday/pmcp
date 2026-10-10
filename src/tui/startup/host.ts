import { interactiveEntry } from "../../cli/entry.js";
import { planLayout } from "../../harness/terminal/layout.js";
import { assertNativeHost } from "../../harness/adapters/systemd/admission.js";
import { dependencies } from "../adapters/process/runtime.js";

export function terminalSupport(): { supported: boolean; reason?: string } {
  try {
    if (!dependencies().supported)
      throw new Error("tui_dependencies_unavailable");
    assertNativeHost();
    planLayout(process.stdout.columns ?? 0, process.stdout.rows ?? 0);
    return { supported: true };
  } catch (error) {
    return {
      supported: false,
      reason: error instanceof Error ? error.message : "terminal_unavailable",
    };
  }
}

export function requireTerminal(): void {
  if (
    !interactiveEntry({
      stdin: process.stdin.isTTY === true,
      stdout: process.stdout.isTTY === true,
      term: process.env.TERM,
      ci: process.env.CI,
    })
  )
    throw new Error("terminal_required");
  const support = terminalSupport();
  if (!support.supported) throw new Error(support.reason);
}
