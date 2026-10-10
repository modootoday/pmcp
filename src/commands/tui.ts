import type { Command } from "../cli/command.js";
import { tuiOptions, parseTui } from "./tui/invocation.js";

export const tuiCommand: Command = {
  name: "tui",
  describe: "View an owned native harness group with explicit input control",
  usage:
    "pmcp tui doctor | create --group-file <file> | operation --view <file>",
  options: tuiOptions,
  async run(context) {
    const invocation = parseTui(context.args);
    const { invokeTui, failedInvocation } =
      await import("../tui/application/invoke.js");
    try {
      const receipt = await invokeTui(invocation);
      if (invocation.action !== "open" || receipt.ok !== true)
        context.ui.data(`${JSON.stringify(receipt)}\n`);
      return receipt.ok === true ? 0 : 1;
    } catch (error) {
      context.ui.data(
        `${JSON.stringify(failedInvocation(invocation.action, error))}\n`,
      );
      return 1;
    }
  },
};
