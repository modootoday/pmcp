import type { Command } from "../cli/command.js";
import { ArgumentError } from "../cli/command.js";
import { ConfigError } from "../config.js";
import { parseTui } from "./tui/invocation.js";
import { tuiSpec } from "./specs/terminal.js";
import { unsupportedHost, unsupportedReceipt } from "../harness/platform.js";

// An error message is code[: detail]; the code is what scripts branch on.
function failed(error: unknown) {
  const message = error instanceof Error ? error.message : "tui_failed";
  const [code, ...detail] = message.split(": ");
  return {
    schemaVersion: 1,
    ok: false,
    error: code,
    ...(detail.length ? { hint: detail.join(": ") } : {}),
    inputReplayed: false,
  };
}

export const tuiCommand: Command = {
  ...tuiSpec,
  async run(context) {
    const invocation = parseTui(context.args);
    const unsupported = unsupportedHost();
    if (unsupported) {
      context.ui.data(`${JSON.stringify(unsupportedReceipt(unsupported))}\n`);
      return 1;
    }
    try {
      let receipt;
      if (invocation.action === "doctor") {
        const { inspectTerminalHost } =
          await import("../tui/startup/diagnostics.js");
        receipt = inspectTerminalHost();
      } else if (invocation.action === "start-worker") {
        const { startWorkspaceWorker } =
          await import("../tui/startup/worker.js");
        receipt = await startWorkspaceWorker(
          { config: invocation.startup?.config, cwd: context.cwd },
          invocation.startup!.runtime!,
          invocation.startup?.memoryMb,
        );
      } else if (invocation.action === "recovery") {
        const { inspectStartupRecovery } =
          await import("../tui/startup/recovery.js");
        receipt = inspectStartupRecovery({
          ...invocation.startup,
          cwd: context.cwd,
        });
      } else {
        const { launchStartup, planStartup } =
          await import("../tui/startup/entry.js");
        const request = { ...invocation.startup, cwd: context.cwd };
        receipt =
          invocation.action === "plan"
            ? planStartup(request)
            : await launchStartup(
                request,
                invocation.startup?.confirmed === true,
              );
      }
      if (invocation.action !== "launch" || receipt.ok !== true)
        context.ui.data(`${JSON.stringify(receipt)}\n`);
      return receipt.ok === true ? 0 : 1;
    } catch (error) {
      if (error instanceof ConfigError) throw new ArgumentError(error.message);
      context.ui.data(`${JSON.stringify(failed(error))}\n`);
      return 1;
    }
  },
};
