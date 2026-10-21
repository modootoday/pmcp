import { readCompiled } from "../compiled.js";
import { projectStateDir } from "../../sessions/state-dir.js";

// Ask the projected hook for state location so the mod and hook cannot disagree.
export function stateDirAnswer(root: string): string {
  let declared: string | undefined;
  try {
    declared = readCompiled(root).stateDir;
  } catch {
    // An unverified policy.json may not choose where the mod writes; use the default.
  }
  return `${projectStateDir(root, declared)}\n`;
}
