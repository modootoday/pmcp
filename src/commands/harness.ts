import { ArgumentError, type Command } from "../cli/command.js";
import { harnessOptions } from "./harness/options.js";
import { parseInvocation } from "./harness/invocation.js";
import { runLayout } from "./harness/layout.js";

export const harnessCommand: Command = {
  name: "harness",
  describe:
    "Manage optional owned native sessions independently of the MCP server",
  usage: "pmcp harness layout | family operation [options]",
  options: harnessOptions,
  async run(context) {
    if (context.args.positional[0] === "layout") return runLayout(context);
    try {
      const operation = parseInvocation(context);
      const { invoke } = await import("../harness/application/invoke.js");
      const receipt = await invoke(operation);
      context.ui.data(`${JSON.stringify(receipt)}\n`);
      return receipt.ok === true ? 0 : 1;
    } catch (error) {
      if (error instanceof ArgumentError) throw error;
      context.ui.data(
        `${JSON.stringify({ schemaVersion: 1, ok: false, error: error instanceof Error ? error.message : "operation_failed", resendAllowed: false })}\n`,
      );
      return 1;
    }
  },
};
