import { ArgumentError, type Command } from "../cli/command.js";
import { parseInvocation } from "./harness/invocation.js";
import { runLayout } from "./harness/layout.js";
import { harnessSpec } from "./specs/terminal.js";
import { unsupportedHost, unsupportedReceipt } from "../harness/platform.js";

export const harnessCommand: Command = {
  ...harnessSpec,
  async run(context) {
    const unsupported = unsupportedHost();
    if (unsupported) {
      context.ui.data(`${JSON.stringify(unsupportedReceipt(unsupported))}\n`);
      return 1;
    }
    if (context.args.positional[0] === "layout") return runLayout(context);
    if (context.args.positional[0] === "mcp") {
      const { runPtyMcp } = await import("./harness/mcp.js");
      return runPtyMcp(context);
    }
    if (context.args.positional[0] === "host") {
      const { runHost } = await import("./harness/host.js");
      return runHost(context);
    }
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
