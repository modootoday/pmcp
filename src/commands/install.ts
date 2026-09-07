import { createInterface } from "node:readline/promises";
import {
  ArgumentError,
  type Command,
  type CommandContext,
} from "../cli/command.js";
import { invocation } from "../cli/invocation.js";
import { readInstalledDependencies } from "../installed.js";
import {
  applyInstallPlan,
  createPackageManagerRunner,
} from "../install/apply.js";
import { installContext, planInstall } from "../install/plan.js";
import { verifyInstalledContent } from "../install/verify-content.js";
import { readSession } from "../remote/session.js";
import {
  issueDistributionCredential,
  revokeDistributionCredential,
  temporaryRegistryConfig,
  verifyRegistryIntegrity,
} from "../remote/distribution.js";
import {
  apiOrigin,
  REMOTE_OPTIONS,
  projectFrom,
  remoteCatalog,
} from "./remote-options.js";

async function manage(context: CommandContext, sync: boolean): Promise<number> {
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
  const install = installContext(project);
  const inventory = readInstalledDependencies(project);
  const catalog = await remoteCatalog(context);
  const plan = planInstall({
    context: install,
    inventory,
    catalog,
    selected: context.args.positional,
    all: context.args.flags.has("all"),
    sync,
  });
  const digests = new Map(
    catalog.entries.map((entry) => [
      entry.delivery.packageName,
      entry.contentDigest,
    ]),
  );
  /**
   * Checks what is on disk against what the catalog described. A name and a
   * version are claims a package makes about itself, and the archive the
   * catalog's integrity covers is gone once npm extracts it.
   */
  const mismatched = (packages: readonly string[]) =>
    packages
      .map((name) =>
        verifyInstalledContent(project, name, digests.get(name) ?? ""),
      )
      .filter((check) => !check.matched);

  const reportMismatch = (checks: ReturnType<typeof mismatched>) => {
    for (const check of checks) {
      context.ui.error(
        "installed content does not match the catalog",
        `${check.packageName}: expected ${check.expected}, found ${check.actual} across ${check.skillCount} skill files`,
      );
    }
  };

  const report = {
    catalogRevision: plan.catalogRevision,
    project,
    changes: plan.changes,
    command: plan.command,
  };
  if (!context.args.flags.has("json")) {
    context.ui.info("project", project);
    for (const entry of plan.changes)
      context.ui.line(`  ${entry.packageName}@${entry.version}`);
    if (plan.changes.length)
      context.ui.line(
        `  ${plan.command.executable} ${plan.command.args.join(" ")}`,
      );
  }
  if (!dryRun && plan.changes.length === 0) {
    // "Nothing to install" is not "nothing to check": after the first install
    // this is the only pass that would notice content drifting from what was
    // paid for.
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
    if (context.args.flags.has("json"))
      context.ui.data(`${JSON.stringify({ status, ...report }, null, 2)}\n`);
    else
      context.ui.info(
        status,
        `${plan.changes.length} changes; nothing written`,
      );
    return 0;
  }
  if (!yes) {
    if (
      !process.stdin.isTTY ||
      !process.stderr.isTTY ||
      context.args.flags.has("json")
    ) {
      throw new ArgumentError(
        "use --yes to apply non-interactively or --dry-run to inspect the plan",
      );
    }
    const prompt = createInterface({
      input: process.stdin,
      output: process.stderr,
    });
    try {
      const answer = await prompt.question(
        "Update this project's dependencies and lockfile? [y/N] ",
      );
      if (!/^y(?:es)?$/iu.test(answer.trim())) {
        context.ui.info("cancelled", "nothing written");
        return 1;
      }
    } finally {
      prompt.close();
    }
  }
  const session = readSession();
  if (
    !session ||
    (session.expiresAt !== undefined && session.expiresAt <= Date.now())
  ) {
    throw new Error(
      `run ${invocation()} login before installing paid skill packages`,
    );
  }
  const origin = apiOrigin(context);
  const credential = await issueDistributionCredential(
    session.accessToken,
    origin,
  );
  const registry = temporaryRegistryConfig(credential);
  let revoked = false;
  try {
    const verified = await verifyRegistryIntegrity(plan.changes, credential);
    const code = applyInstallPlan(
      plan,
      createPackageManagerRunner(
        registry.path,
        { ...process.env, ...registry.environment },
        verified,
      ),
    );
    if (code !== 0) {
      context.ui.error(
        "package manager failed",
        `exit ${code}; inspect the project before retrying`,
      );
      return code;
    }
    // The catalog's integrity covers the archive npm has now discarded, so the
    // installed files are checked against the digest of what was described.
    // A name and a version are claims a package makes about itself.
    const wrong = mismatched(plan.changes.map((change) => change.packageName));
    if (wrong.length > 0) {
      reportMismatch(wrong);
      return 1;
    }
    if (context.args.flags.has("json"))
      context.ui.data(
        `${JSON.stringify({ status: "applied", ...report }, null, 2)}\n`,
      );
    else context.ui.success(`${plan.changes.length} skill packages installed`);
    return 0;
  } finally {
    registry.close();
    revoked = await revokeDistributionCredential(
      session.accessToken,
      credential.id,
      origin,
    );
    if (!revoked)
      context.ui.warn(
        "temporary registry credential expires automatically",
        credential.expiresAt,
      );
  }
}

const OPTIONS = [
  ...REMOTE_OPTIONS,
  {
    name: "dry-run",
    describe: "Show the plan without installing or changing files.",
    boolean: true,
  },
  {
    name: "yes",
    describe: "Approve the displayed project and lockfile changes.",
    boolean: true,
  },
];

export const installCommand: Command = {
  name: "install",
  describe:
    "Install matching skill npm packages with the project's package manager",
  usage: "pmcp install <skill-package>... | --all [--dry-run | --yes]",
  options: [
    ...OPTIONS,
    {
      name: "all",
      describe: "Select all matching skill packages.",
      boolean: true,
    },
  ],
  run: (context) => manage(context, false),
};
export const syncCommand: Command = {
  name: "sync",
  describe:
    "Update declared skill packages without removing other dependencies",
  usage: "pmcp sync [--project <dir>] [--dry-run | --yes]",
  options: OPTIONS,
  run: (context) => manage(context, true),
};
