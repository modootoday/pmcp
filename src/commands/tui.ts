import type { Command } from "../cli/command.js";
import { ArgumentError } from "../cli/command.js";
import { ConfigError } from "../config.js";
import { tuiOptions, parseTui } from "./tui/invocation.js";

export const tuiCommand: Command = {
  name: "tui",
  describe: "Open a native terminal workspace with optional configuration",
  usage:
    "pmcp tui [--config <file>] [--runtime <id>] | plan | recovery | doctor | start-worker --runtime <id> | operation --view <file>",
  options: tuiOptions,
  async run(context) {
    const invocation = parseTui(context.args);
    const { invokeTui, failedInvocation } =
      await import("../tui/application/invoke.js");
    try {
      let receipt;
      if (invocation.action === "start-worker") {
        if (invocation.viewFile) {
          const { startViewWorker } =
            await import("../tui/application/worker-start.js");
          receipt = await startViewWorker(
            invocation.viewFile,
            invocation.startup!.runtime!,
            invocation.startup?.memoryMb,
          );
        } else {
          const { startWorkspaceWorker } =
            await import("../tui/startup/worker.js");
          receipt = await startWorkspaceWorker(
            { config: invocation.startup?.config, cwd: context.cwd },
            invocation.startup!.runtime!,
            invocation.startup?.memoryMb,
          );
        }
      } else if (invocation.action === "recovery") {
        const { inspectStartupRecovery } =
          await import("../tui/startup/recovery.js");
        receipt = inspectStartupRecovery({
          ...invocation.startup,
          cwd: context.cwd,
        });
      } else if (
        invocation.action === "launch" ||
        invocation.action === "plan"
      ) {
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
      } else {
        receipt = await invokeTui(invocation);
      }
      if (
        !["open", "launch"].includes(invocation.action) ||
        receipt.ok !== true
      )
        context.ui.data(`${JSON.stringify(receipt)}\n`);
      return receipt.ok === true ? 0 : 1;
    } catch (error) {
      if (error instanceof ConfigError) throw new ArgumentError(error.message);
      context.ui.data(
        `${JSON.stringify(failedInvocation(invocation.action, error))}\n`,
      );
      return 1;
    }
  },
};
