import { interactiveEntry } from "../../cli/entry.js";
import { planLayout } from "../../harness/terminal/layout.js";
import { assertNativeHost } from "../../harness/adapters/systemd/admission.js";
import { dependencies } from "./dependencies.js";

export function terminalSupport(options?: { uncapped?: boolean }): {
  supported: boolean;
  reason?: string;
} {
  try {
    if (!dependencies(options).supported)
      throw new Error("tui_dependencies_unavailable");
    assertNativeHost(options);
    planLayout(process.stdout.columns ?? 0, process.stdout.rows ?? 0);
    return { supported: true };
  } catch (error) {
    return {
      supported: false,
      reason: error instanceof Error ? error.message : "terminal_unavailable",
    };
  }
}

export function requireTerminal(options?: { uncapped?: boolean }): void {
  if (
    !interactiveEntry({
      stdin: process.stdin.isTTY === true,
      stdout: process.stdout.isTTY === true,
      term: process.env.TERM,
      ci: process.env.CI,
    })
  )
    throw new Error("terminal_required");
  const support = terminalSupport(options);
  if (!support.supported) throw new Error(support.reason);
}
