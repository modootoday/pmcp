import type { Command } from "../cli/command.js";

import { catalogFrom, rootsFrom } from "./roots.js";
import { listSpec } from "./specs/catalog.js";

export const listCommand: Command = {
  ...listSpec,
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

    // Report rejected assets so tier-validation failures cannot be hidden by serving other results.
    for (const { path, reason } of rejected)
      context.ui.error("skipped", `${path}: ${reason}`);

    // Signal an empty catalog so automation can detect a likely discovery misconfiguration.
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
