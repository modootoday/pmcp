import type { Command } from "../cli/command.js";
import { ArgumentError } from "../cli/command.js";
import { ConfigError } from "../config.js";
import { tuiOptions, parseTui } from "./tui/invocation.js";

export const tuiCommand: Command = {
  name: "tui",
  describe: "Open a native terminal workspace with optional configuration",
  usage:
    "pmcp tui [--config <file>] [--runtime <id>] | plan | doctor | operation --view <file>",
  options: tuiOptions,
  async run(context) {
    const invocation = parseTui(context.args);
    const { invokeTui, failedInvocation } =
      await import("../tui/application/invoke.js");
    try {
      let receipt;
      if (invocation.action === "launch" || invocation.action === "plan") {
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
