import type { Command } from "../cli/command.js";

import { CATALOG_OPTIONS, catalogFrom, rootsFrom } from "./roots.js";

export const listCommand: Command = {
  name: "list",
  describe: "List the skills discovered in node_modules and marketplaces",
  usage:
    "pmcp list [--root <dir>] [--scope <prefix>] [--marketplace <dir>] [--package <dir>] [--workspace <dir|glob>] [--config <file> | --no-config] [--json]",
  options: [
    ...CATALOG_OPTIONS,
    { name: "json", describe: "Emit JSON rather than a table.", boolean: true },
  ],
  run(context) {
    const rejected: { path: string; reason: string }[] = [];
    const entries = catalogFrom(context, (rejection) =>
      rejected.push(rejection),
    );

    if (context.args.flags.has("json")) {
      context.ui.data(
        `${JSON.stringify({ skills: entries, rejected }, null, 2)}\n`,
      );
      return entries.length > 0 && rejected.length === 0 ? 0 : 1;
    }

    // A rejected skill is a mislabelled one, and serving around it would hide
    // the leak the tier check exists to catch.
    for (const { path, reason } of rejected)
      context.ui.error("skipped", `${path}: ${reason}`);

    // An empty catalog is a finding, not a success: a project that installed
    // this and sees nothing has a misconfiguration worth an exit code.
    if (entries.length === 0) {
      context.ui.error("no skills found", rootsFrom(context).join(" "));
      return 1;
    }

    context.ui.table(
      entries.map((entry) => {
        const tags = [entry.kind, entry.tier].filter(Boolean).join(", ");
        return [
          tags === "" ? entry.name : `${entry.name} [${tags}]`,
          entry.description,
        ];
      }),
    );
    const counts = new Map<string, number>();
    for (const entry of entries) {
      const kind = entry.kind ?? "skill";
      counts.set(kind, (counts.get(kind) ?? 0) + 1);
    }
    const plural: Record<string, string> = {
      skill: "skills",
      agent: "agents",
      hook: "hooks",
      mcp: "MCP servers",
    };
    context.ui.success(
      [...counts].map(([kind, n]) => `${n} ${plural[kind] ?? kind}`).join(", "),
    );
    return rejected.length === 0 ? 0 : 1;
  },
};
