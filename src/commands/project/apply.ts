import type { CommandContext } from "../../cli/command.js";
import { RUNTIMES } from "../../hooks/runtimes/index.js";
import { project } from "../../project/apply.js";
import { addEntry, findEntry, removeAsset } from "../../project/edit.js";
import { recordProjector } from "../../project/projector.js";
import type { ProjectSpec } from "../../project/spec.js";
import { catalogFrom } from "../roots.js";
import { specFrom } from "./spec-from.js";

function reproject(context: CommandContext, spec: ProjectSpec): number {
  const result = project(spec, { check: false });
  for (const problem of result.problems) context.ui.error(problem);
  if (result.code !== 0) {
    return 1;
  }
  recordProjector(spec);
  if (result.backup) {
    context.ui.info("backup", result.backup);
  }
  context.ui.success(
    `projected ${result.outputs} outputs`,
    result.pruned > 0 ? `pruned ${result.pruned}` : undefined,
  );
  for (const deprecation of spec.deprecations ?? [])
    context.ui.warn(deprecation);
  // pmcp never trusts a folder for the user; it only says the step is theirs.
  for (const id of spec.hookBundle?.policy?.targets ?? []) {
    if (RUNTIMES[id].trust !== "folder") continue;
    context.ui.info(
      id,
      "hooks run only once you trust this folder in the runtime; pmcp doctor reports it",
    );
  }
  return 0;
}

export function projectOrCheck(context: CommandContext): number {
  const spec = specFrom(context);
  if (!context.args.flags.has("check")) {
    return reproject(context, spec);
  }
  const result = project(spec, { check: true });
  for (const problem of result.problems) context.ui.error(problem);
  for (const warning of result.warnings ?? []) context.ui.warn(warning);
  if (result.code !== 0) {
    context.ui.info(
      "fix",
      "pmcp project (edit .agents/ or pmcp.toml, never the outputs)",
    );
    return 2;
  }
  context.ui.success(`${result.outputs} outputs match`);
  return 0;
}

export function addAndProject(context: CommandContext, name: string): number {
  const spec = specFrom(context);
  const added = addEntry(spec.root, findEntry(catalogFrom(context), name));
  context.ui.success(`added ${added.kind} ${added.name}`, added.path);
  return reproject(context, specFrom(context));
}

export function removeAndProject(
  context: CommandContext,
  name: string,
): number {
  const spec = specFrom(context);
  for (const path of removeAsset(spec.root, name)) {
    context.ui.success("removed", path);
  }
  return reproject(context, specFrom(context));
}
