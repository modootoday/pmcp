import type { Output } from "../outputs.js";
import { isPermissionPath, permissionProblems } from "../permissions.js";
import { lockVersionProblem } from "../projector.js";
import type { ProjectSpec } from "../spec.js";
import { deadGlobs, undeclared } from "./census.js";
import { present } from "./present.js";
import type { LockEntry } from "./types.js";

export function checkProblems(
  spec: ProjectSpec,
  outputs: readonly Output[],
  stale: readonly LockEntry[],
): string[] {
  return [
    ...outputs
      .filter((o) => !isPermissionPath(o.path) && !present(spec.root, o))
      .map((o) => `drift: ${o.path}`),
    ...permissionProblems(spec),
    ...stale.map((e) => `stale: ${e.path}`),
    ...undeclared(spec, outputs).map((p) => `undeclared: ${p}`),
    ...deadGlobs(spec.root, outputs).map((p) => `dead glob: ${p}`),
    ...[lockVersionProblem(spec.root)].filter((p) => p !== null),
  ];
}
