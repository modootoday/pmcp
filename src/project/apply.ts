// Track ownership so removed sources can be pruned without overwriting unmanaged files.

import { changedSincePlan } from "./apply/_shared.js";
import { checkProject } from "./apply/check-project.js";
import { prepare } from "./apply/prepare.js";
import { writeFiles } from "./apply/files.js";
import { pruneLegacyRules } from "./apply/legacy-rules.js";
import { writeLock } from "./apply/lock.js";
import { writeNative } from "./apply/native.js";
import { replaceable } from "./apply/replaceable.js";
import { backupBeforeWrite } from "./apply/safeguard.js";
import type { ProjectResult } from "./apply/types.js";
import { permissionConflicts } from "./permissions.js";
import type { ProjectSpec } from "./spec.js";

export { deadGlobs } from "./apply/census.js";
export { LOCK_FILE } from "./apply/lock.js";
export type { ProjectResult } from "./apply/types.js";

export function project(
  spec: ProjectSpec,
  options: { readonly check: boolean },
): ProjectResult {
  if (options.check) return checkProject(spec);
  const { outputs, owned, stale, basis } = prepare(spec);

  const refused = outputs
    .filter((o) => !replaceable(spec.root, o, owned))
    .map((o) => `refusing to overwrite a file it did not write: ${o.path}`);
  if (refused.length > 0) {
    return { code: 3, problems: refused, outputs: outputs.length, pruned: 0 };
  }
  // A hand-edited owned permission is operator intent, so it is reported and never repaired.
  const conflicts = [
    ...permissionConflicts(spec),
    ...changedSincePlan(spec.root, basis),
  ];
  if (conflicts.length > 0) {
    return { code: 3, problems: conflicts, outputs: outputs.length, pruned: 0 };
  }
  const backup = backupBeforeWrite(spec, outputs, stale);
  writeFiles(spec.root, outputs);
  const pruned =
    writeNative(spec.root, outputs, stale, basis) +
    pruneLegacyRules(spec, outputs);
  writeLock(spec.root, outputs);
  return {
    code: 0,
    problems: [],
    outputs: outputs.length,
    pruned,
    ...(backup ? { backup } : {}),
  };
}
