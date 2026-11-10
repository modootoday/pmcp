import {
  ArgumentError,
  EXIT,
  one,
  type CommandContext,
} from "../../../cli/command.js";
import { ioPlan, planText } from "../plan.js";
import { readRecord, recordPath } from "../record.js";
import { leaseOf } from "./shared.js";

const UNIT = /^[A-Za-z0-9:_.@-]+\.service$/u;

// Prints only: writing /sys or /etc needs root, which stays with the operator.
export function ioPlanCommand(context: CommandContext): number {
  const lease = leaseOf(context);
  const unit = one(context.args, "unit");
  if (unit !== undefined && !UNIT.test(unit))
    throw new ArgumentError(
      "--unit names a .service unit, such as iocost.service",
    );
  const record = readRecord(lease.dir);
  if (record === null || Object.keys(record.devices).length === 0) {
    context.ui.error(
      `no io model recorded in ${recordPath(lease.dir)}; run pmcp host io measure first`,
    );
    return EXIT.failure;
  }
  const plan = ioPlan(record, unit);
  if (context.args.flags.has("json")) {
    context.ui.data(`${JSON.stringify({ version: 1, ...plan })}\n`);
    return EXIT.ok;
  }
  context.ui.data(planText(plan));
  return EXIT.ok;
}
