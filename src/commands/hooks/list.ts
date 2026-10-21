import { ArgumentError, one, type CommandContext } from "../../cli/command.js";
import { policyRows } from "../../hooks/inspection/list.js";
import { RUNTIME_IDS } from "../../hooks/contract.js";
import { specFrom } from "../project/spec-from.js";

export function run(context: CommandContext): number {
  const runtime = one(context.args, "runtime");
  if (runtime && !(RUNTIME_IDS as readonly string[]).includes(runtime))
    throw new ArgumentError("--runtime must be claude or codex");
  for (const option of ["event", "command", "path", "tool", "session-state"]) {
    if (one(context.args, option))
      throw new ArgumentError("--" + option + " requires hooks test");
  }
  const spec = specFrom(context);
  const rows = policyRows(spec.hookBundle?.policy).filter(
    (row) => !runtime || row.runtime === runtime,
  );
  if (context.args.flags.has("json")) {
    context.ui.data(JSON.stringify({ version: 1, policies: rows }) + "\n");
    return 0;
  }
  if (!rows.length) context.ui.line("No compiled policies.");
  for (const row of rows)
    context.ui.data(
      [row.runtime, row.event, row.policy, row.mode, row.source].join("\t") +
        "\n",
    );
  return 0;
}
