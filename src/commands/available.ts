import { ArgumentError, type Command } from "../cli/command.js";
import { readInstalledDependencies } from "../installed.js";
import { matchingSkills } from "../install/plan.js";
import { REMOTE_OPTIONS, projectFrom, remoteCatalog } from "./remote-options.js";

export const availableCommand: Command = {
  name: "available",
  describe: "Find provided skills matching this project's installed dependencies",
  usage: "pmcp available [--project <dir>] [--catalog <file>] [--json]",
  options: REMOTE_OPTIONS,
  async run(context) {
    if (context.args.positional.length) throw new ArgumentError("available takes no package arguments");
    const inventory = readInstalledDependencies(projectFrom(context));
    const catalog = await remoteCatalog(context);
    const matches = matchingSkills(catalog, inventory);
    if (context.args.flags.has("json")) {
      context.ui.data(`${JSON.stringify({ catalogRevision: catalog.revision, matches, issues: inventory.issues }, null, 2)}\n`);
    } else {
      for (const match of matches) {
        const status = match.verified ? "verified" : "compatible, not verified at this exact version";
        context.ui.data(`${match.targetName}@${match.targetVersion}\t${match.entry.delivery.packageName}@${match.entry.delivery.version}\t${status}\n`);
      }
      context.ui.info(`${matches.length} matching skills`, catalog.revision);
      for (const issue of inventory.issues) context.ui.warn(issue.reason, issue.name);
    }
    return inventory.issues.length ? 1 : 0;
  },
};
