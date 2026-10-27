// A custom guard that names an installed program is pinned by the version it reports, so a
// program upgraded under a reviewed projection is refused until the pin is reviewed again.

import { programVersion, versionMatches } from "../hooks/policies/custom.js";
import type { ProjectSpec } from "./spec.js";

export function guardVersionProblems(
  spec: ProjectSpec,
  env: Readonly<Record<string, string | undefined>> = process.env,
): string[] {
  const problems: string[] = [];
  for (const entry of spec.hookBundle?.policy?.custom ?? []) {
    if (entry.version === undefined) continue;
    const program = entry.command[0] ?? "";
    const output = programVersion(program, spec.root, env);
    if (output === null)
      problems.push(
        `custom guard ${entry.name}: ${program} --version did not run; install ${program} ${entry.version}`,
      );
    else if (!versionMatches(output, entry.version))
      problems.push(
        `custom guard ${entry.name}: ${program} --version reports "${output.split("\n")[0]}", not ${entry.version}; review the program and update version`,
      );
  }
  return problems;
}
