import type { CommandContext } from "../../cli/command.js";
import {
  applyInstallPlan,
  createPackageManagerRunner,
} from "../../install/apply.js";
import {
  preparePublicDelivery,
  verifyPublicDelivery,
} from "../../install/public.js";
import type { InstallOperation } from "./types.js";

export async function applyPublic(
  context: CommandContext,
  operation: InstallOperation,
): Promise<number> {
  const { project, plan, catalog, report } = operation;
  const delivery = await preparePublicDelivery(plan, catalog);
  const code = applyInstallPlan(
    plan,
    createPackageManagerRunner(undefined, process.env, delivery.integrity),
  );
  if (code !== 0) {
    context.ui.error(
      "package manager failed",
      `exit ${code}; inspect the project before retrying`,
    );
    return code;
  }
  verifyPublicDelivery(project, delivery);
  if (context.args.flags.has("json")) {
    context.ui.data(
      `${JSON.stringify({ status: "applied", ...report }, null, 2)}\n`,
    );
    return 0;
  }
  context.ui.success(`${plan.changes.length} public skill packages installed`);
  return 0;
}
