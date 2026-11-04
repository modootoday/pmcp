import { resolve } from "node:path";

import { ArgumentError, one, type CommandContext } from "../../cli/command.js";
import { ConfigError, findConfig, readConfig } from "../../config.js";
import { readAffectedConfig, type AffectedConfig } from "../affected/config.js";
import { selectAffected, type Selection } from "../affected/select.js";
import { gitText } from "../exec.js";

export const AFFECTED_SCHEMA = "pmcp.git.affected.v1";

function select(context: CommandContext, base: string): Selection {
  const root = gitText(context.cwd, ["rev-parse", "--show-toplevel"]);
  if (!root)
    return {
      all: true,
      reason: `${context.cwd} is not inside a git checkout`,
      changed: [],
      members: [],
      unmapped: [],
    };
  const configPath = one(context.args, "config");
  const path =
    configPath === undefined
      ? findConfig(context.cwd)
      : resolve(context.cwd, configPath);
  let config: AffectedConfig | null;
  try {
    config = path === null ? null : readAffectedConfig(readConfig(path));
  } catch (error) {
    if (error instanceof ConfigError) throw new ArgumentError(error.message);
    throw error;
  }
  if (config === null)
    return {
      all: true,
      reason: "[git.affected] is absent, so nothing maps a path to a member",
      changed: [],
      members: [],
      unmapped: [],
    };
  return selectAffected(
    root,
    config,
    base,
    one(context.args, "head") ?? "HEAD",
    context.args.flags.has("tests-only"),
  );
}

// Exit 0 with an answer, ALL included; only unusable arguments or configuration exit 2.
export function gitAffected(context: CommandContext): number {
  const base = one(context.args, "base");
  if (base === undefined)
    throw new ArgumentError("git affected needs --base <ref>");
  const selection = select(context, base);
  const testsOnly = context.args.flags.has("tests-only");
  const list = testsOnly ? selection.changed : selection.members;
  if (context.args.flags.has("json")) {
    context.ui.data(
      JSON.stringify({
        schema: AFFECTED_SCHEMA,
        testsOnly,
        ...selection,
        selected: selection.all ? "ALL" : list,
      }) + "\n",
    );
    return 0;
  }
  for (const path of selection.unmapped)
    context.ui.warn(`unmapped, not tested: ${path}`);
  if (selection.all) {
    context.ui.warn(`ALL: ${selection.reason ?? "unknown"}`);
    context.ui.data("ALL\n");
    return 0;
  }
  if (list.length > 0) context.ui.data(list.join("\n") + "\n");
  return 0;
}
