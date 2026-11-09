import { relative, resolve, sep } from "node:path";

import {
  ArgumentError,
  EXIT,
  NO_CONFIG,
  type Command,
  type CommandContext,
} from "../cli/command.js";
import { ownersOf, readOwners, type OwnerEntry } from "../hooks/owners.js";
import { configFrom } from "./config-from.js";
import { ownersSpec } from "./specs/owners.js";

// Paths are taken from the working directory and matched relative to the pmcp.toml directory.
function run(context: CommandContext): number {
  const paths = context.args.positional;
  if (paths.length === 0) throw new ArgumentError("name at least one path");
  const config = configFrom(context);
  if (config === null) throw new ArgumentError(NO_CONFIG);
  let entries: OwnerEntry[];
  try {
    entries = readOwners(config.raw["owners"]);
  } catch (error) {
    throw new ArgumentError(`${config.path}: ${(error as Error).message}`);
  }
  const rows = paths.map((path) => {
    const inProject = relative(config.dir, resolve(context.cwd, path))
      .split(sep)
      .join("/");
    return {
      path: inProject,
      owners: ownersOf(entries, inProject).map((entry) => ({
        owner: entry.owner,
        ...(entry.note ? { note: entry.note } : {}),
        mode: entry.mode,
      })),
    };
  });
  if (context.args.flags.has("json")) {
    context.ui.data(`${JSON.stringify({ version: 1, paths: rows })}\n`);
    return EXIT.ok;
  }
  const lines = rows.flatMap((row) =>
    row.owners.length === 0
      ? [`${row.path}: no owner`]
      : row.owners.map(
          (entry) =>
            `${row.path} belongs to ${entry.owner}${entry.note ? `: ${entry.note}` : ""}${entry.mode === "observe" ? " (observe)" : ""}`,
        ),
  );
  context.ui.data(`${lines.join("\n")}\n`);
  return EXIT.ok;
}

export const ownersCommand: Command = { ...ownersSpec, run };
