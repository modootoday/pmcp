import { join } from "node:path";

import { readCompiled, type CompiledPolicy } from "../compiled.js";
import { STATE_FILES } from "../../sessions/format.js";
import { pauseFileFor } from "../../sessions/lease-files.js";
import { projectStateDir } from "../../sessions/state-dir.js";

function verified(root: string): CompiledPolicy | null {
  try {
    return readCompiled(root);
  } catch {
    // An unverified policy.json may not choose where the mod writes; use the default.
    return null;
  }
}

// Ask the projected hook for state location so the mod and hook cannot disagree.
export function stateDirAnswer(root: string): string {
  return `${projectStateDir(root, verified(root)?.stateDir)}\n`;
}

// The pause the hooks read: [sessions] pause_file, else pause.json in the state dir.
export function pauseFileAnswer(root: string): string {
  const compiled = verified(root);
  const stateDir = projectStateDir(root, compiled?.stateDir);
  const file = pauseFileFor(
    root,
    stateDir,
    compiled?.sessions.pauseFile,
    compiled?.sessions.gate,
    process.env,
  );
  return `${file ?? join(stateDir, STATE_FILES.pause)}\n`;
}
