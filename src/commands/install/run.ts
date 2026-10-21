import type { CommandContext } from "../../cli/command.js";
import { prepare } from "./plan.js";
import { approve } from "./approval.js";
import { reportPlan } from "./report.js";
import { applyPublic } from "./public-delivery.js";
import { applyHosted } from "./hosted-delivery.js";

export async function manage(
  context: CommandContext,
  sync: boolean,
): Promise<number> {
  const dryRun = context.args.flags.has("dry-run");
  const yes = context.args.flags.has("yes");
  const operation = await prepare(context, sync);
  const {
    provider,
    inventory,
    plan,
    digests,
    report,
    mismatched,
    reportMismatch,
  } = operation;
  reportPlan(context, operation);
  if (!dryRun && plan.changes.length === 0) {
    const drifted = mismatched(
      inventory.dependencies
        .filter((dependency) => digests.has(dependency.name))
        .map((dependency) => dependency.name),
    );
    if (drifted.length > 0) {
      reportMismatch(drifted);
      return 1;
    }
  }
  if (dryRun || plan.changes.length === 0) {
    const status = dryRun ? "planned" : "unchanged";
    if (context.args.flags.has("json")) {
      context.ui.data(`${JSON.stringify({ status, ...report }, null, 2)}\n`);
    } else {
      context.ui.info(
        status,
        `${plan.changes.length} changes; nothing written`,
      );
    }
    return 0;
  }
  if (!yes && !(await approve(context))) return 1;
  if (provider === "public") return applyPublic(context, operation);
  return applyHosted(context, operation);
}
