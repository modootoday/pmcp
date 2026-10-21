import { ArgumentError, type CommandContext } from "../../cli/command.js";
import { readInstalledDependencies } from "../../installed.js";
import { installContext, planInstall } from "../../install/plan.js";
import { publicInstallPlan } from "../../install/public.js";
import {
  catalogProvider,
  projectFrom,
  remoteCatalog,
} from "../remote-options.js";
import { verification } from "./_shared.js";
import type { InstallOperation } from "./types.js";

export async function prepare(
  context: CommandContext,
  sync: boolean,
): Promise<InstallOperation> {
  const dryRun = context.args.flags.has("dry-run");
  const yes = context.args.flags.has("yes");
  if (dryRun && yes)
    throw new ArgumentError("choose --dry-run or --yes, not both");
  if (sync && context.args.positional.length)
    throw new ArgumentError("sync takes no package arguments");
  if (
    !sync &&
    !context.args.positional.length &&
    !context.args.flags.has("all")
  ) {
    throw new ArgumentError("select a skill package or pass --all");
  }
  const project = projectFrom(context);
  const provider = catalogProvider(context);
  const install = installContext(project);
  const inventory = readInstalledDependencies(project);
  const catalog = await remoteCatalog(context);
  const selectedPlan = planInstall({
    context: install,
    inventory,
    catalog,
    selected: context.args.positional,
    all: context.args.flags.has("all"),
    sync,
  });
  const plan =
    provider === "public"
      ? publicInstallPlan(selectedPlan, catalog)
      : selectedPlan;
  const digests = new Map(
    catalog.entries.map((entry) => [
      entry.delivery.packageName,
      entry.contentDigest,
    ]),
  );
  const report = {
    catalogRevision: plan.catalogRevision,
    project,
    changes: plan.changes,
    command: plan.command,
  };
  return {
    project,
    provider,
    inventory,
    catalog,
    plan,
    digests,
    report,
    ...verification(context, project, digests),
  };
}
