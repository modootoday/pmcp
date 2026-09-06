/**
 * The two options every command that reads the catalog shares, declared once so
 * a flag cannot mean one thing under list and another under index.
 */

import { many, type CommandContext, type OptionSpec } from "../cli/command.js";
import { readCatalog, type SkillEntry } from "../catalog.js";

export const CATALOG_OPTIONS: readonly OptionSpec[] = [
  {
    name: "root",
    describe: "A node_modules directory to walk. Repeatable.",
    repeat: true,
    placeholder: "<dir>",
  },
  {
    name: "scope",
    describe: "Only packages whose names start with this. Repeatable.",
    repeat: true,
    placeholder: "<prefix>",
  },
];

export function rootsFrom(context: CommandContext): readonly string[] {
  const given = many(context.args, "root");
  return given.length > 0 ? given : [`${context.cwd}/node_modules`];
}

export function catalogFrom(context: CommandContext): SkillEntry[] {
  const scopes = many(context.args, "scope");
  const roots = rootsFrom(context);
  return readCatalog(scopes.length > 0 ? { roots, scopes } : { roots });
}
