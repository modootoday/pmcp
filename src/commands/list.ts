import type { Command } from "../cli/command.js";

import { CATALOG_OPTIONS, catalogFrom, rootsFrom } from "./roots.js";

export const listCommand: Command = {
  name: "list",
  describe: "List the skills discovered in node_modules",
  usage: "pmcp list [--root <dir>] [--scope <prefix>] [--json]",
  options: [
    ...CATALOG_OPTIONS,
    { name: "json", describe: "Emit JSON rather than a table.", boolean: true },
  ],
  run(context) {
    const entries = catalogFrom(context);

    if (context.args.flags.has("json")) {
      context.ui.data(`${JSON.stringify(entries, null, 2)}\n`);
      return entries.length > 0 ? 0 : 1;
    }

    // An empty catalog is a finding, not a success: a project that installed
    // this and sees nothing has a misconfiguration worth an exit code.
    if (entries.length === 0) {
      context.ui.error("no skills found", rootsFrom(context).join(" "));
      return 1;
    }

    context.ui.table(entries.map((entry) => [entry.name, entry.description]));
    context.ui.success(`${entries.length} skills`);
    return 0;
  },
};
