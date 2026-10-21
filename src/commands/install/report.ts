import type { CommandContext } from "../../cli/command.js";
import type { InstallOperation } from "./types.js";

export function reportPlan(
  context: CommandContext,
  operation: InstallOperation,
): void {
  const { project, plan } = operation;
  if (!context.args.flags.has("json")) {
    context.ui.info("project", project);
    for (const entry of plan.changes)
      context.ui.line(`  ${entry.packageName}@${entry.version}`);
    if (plan.changes.length)
      context.ui.line(
        `  ${plan.command.executable} ${plan.command.args.join(" ")}`,
      );
    for (const entry of plan.recalled) {
      context.ui.warn(
        "recalled",
        `${entry.packageName} is written for versions a ${entry.line.recall?.severity ?? "high"} advisory covers`,
      );
      if (entry.line.recall) {
        context.ui.line(`  ${entry.line.recall.summary}`);
        context.ui.line(`  ${entry.line.recall.advisoryUrl}`);
      }
    }
  }
}
