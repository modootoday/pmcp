import { createInterface } from "node:readline/promises";
import { ArgumentError, type Command, type CommandContext } from "../cli/command.js";
import { readInstalledDependencies } from "../installed.js";
import { applyInstallPlan, createPackageManagerRunner } from "../install/apply.js";
import { installContext, planInstall } from "../install/plan.js";
import { readSession } from "../remote/session.js";
import {
  issueDistributionCredential,
  revokeDistributionCredential,
  temporaryRegistryConfig,
  verifyRegistryIntegrity,
} from "../remote/distribution.js";
import { apiOrigin, REMOTE_OPTIONS, projectFrom, remoteCatalog } from "./remote-options.js";

async function manage(context: CommandContext, sync: boolean): Promise<number> {
  const dryRun = context.args.flags.has("dry-run");
  const yes = context.args.flags.has("yes");
  if (dryRun && yes) throw new ArgumentError("choose --dry-run or --yes, not both");
  if (sync && context.args.positional.length) throw new ArgumentError("sync takes no package arguments");
  if (!sync && !context.args.positional.length && !context.args.flags.has("all")) {
    throw new ArgumentError("select a skill package or pass --all");
  }
  const project = projectFrom(context);
  const install = installContext(project);
  const inventory = readInstalledDependencies(project);
  const catalog = await remoteCatalog(context);
  const plan = planInstall({
    context: install, inventory, catalog, selected: context.args.positional,
    all: context.args.flags.has("all"), sync,
  });
  const report = { catalogRevision: plan.catalogRevision, project, changes: plan.changes, command: plan.command };
  if (!context.args.flags.has("json")) {
    context.ui.info("project", project);
    for (const entry of plan.changes) context.ui.line(`  ${entry.packageName}@${entry.version}`);
    if (plan.changes.length) context.ui.line(`  ${plan.command.executable} ${plan.command.args.join(" ")}`);
  }
  if (dryRun || plan.changes.length === 0) {
    const status = dryRun ? "planned" : "unchanged";
    if (context.args.flags.has("json")) context.ui.data(`${JSON.stringify({ status, ...report }, null, 2)}\n`);
    else context.ui.info(status, `${plan.changes.length} changes; nothing written`);
    return 0;
  }
  if (!yes) {
    if (!process.stdin.isTTY || !process.stderr.isTTY || context.args.flags.has("json")) {
      throw new ArgumentError("use --yes to apply non-interactively or --dry-run to inspect the plan");
    }
    const prompt = createInterface({ input: process.stdin, output: process.stderr });
    try {
      const answer = await prompt.question("Update this project's dependencies and lockfile? [y/N] ");
      if (!/^y(?:es)?$/iu.test(answer.trim())) {
        context.ui.info("cancelled", "nothing written");
        return 1;
      }
    } finally { prompt.close(); }
  }
  const session = readSession();
  if (!session || (session.expiresAt !== undefined && session.expiresAt <= Date.now())) {
    throw new Error("run pmcp login before installing paid skill packages");
  }
  const origin = apiOrigin(context);
  const credential = await issueDistributionCredential(session.accessToken, origin);
  const registry = temporaryRegistryConfig(credential);
  let revoked = false;
  try {
    const verified = await verifyRegistryIntegrity(plan.changes, credential);
    const code = applyInstallPlan(plan, createPackageManagerRunner(
      registry.path,
      { ...process.env, ...registry.environment },
      verified,
    ));
    if (code !== 0) {
      context.ui.error("package manager failed", `exit ${code}; inspect the project before retrying`);
      return code;
    }
    if (context.args.flags.has("json")) context.ui.data(`${JSON.stringify({ status: "applied", ...report }, null, 2)}\n`);
    else context.ui.success(`${plan.changes.length} skill packages installed`);
    return 0;
  } finally {
    registry.close();
    revoked = await revokeDistributionCredential(session.accessToken, credential.id, origin);
    if (!revoked) context.ui.warn("temporary registry credential expires automatically", credential.expiresAt);
  }
}

const OPTIONS = [
  ...REMOTE_OPTIONS,
  { name: "dry-run", describe: "Show the plan without installing or changing files.", boolean: true },
  { name: "yes", describe: "Approve the displayed project and lockfile changes.", boolean: true },
];

export const installCommand: Command = {
  name: "install",
  describe: "Install matching skill npm packages with the project's package manager",
  usage: "pmcp install <skill-package>... | --all [--dry-run | --yes]",
  options: [...OPTIONS, { name: "all", describe: "Select all matching skill packages.", boolean: true }],
  run: (context) => manage(context, false),
};
export const syncCommand: Command = {
  name: "sync",
  describe: "Update declared skill packages without removing other dependencies",
  usage: "pmcp sync [--project <dir>] [--dry-run | --yes]",
  options: OPTIONS,
  run: (context) => manage(context, true),
};
