import { guardVersionProblems } from "../guard-versions.js";
import { permissionWarnings } from "../permissions.js";
import type { ProjectSpec } from "../spec.js";
import type { ProjectResult } from "./types.js";
import { checkProblems } from "./check.js";
import { prepare } from "./prepare.js";

export function checkProject(spec: ProjectSpec): ProjectResult {
  const { outputs, stale } = prepare(spec);
  const problems = [
    ...checkProblems(spec, outputs, stale),
    ...guardVersionProblems(spec),
  ];
  const warnings = [...permissionWarnings(spec), ...(spec.deprecations ?? [])];
  return {
    code: problems.length > 0 ? 2 : 0,
    problems,
    ...(warnings.length > 0 ? { warnings } : {}),
    outputs: outputs.length,
    pruned: 0,
  };
}
