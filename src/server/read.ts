import { readSkillFile, type ReadResult } from "../files/read.js";
import type { ToolsContext } from "./types.js";
export function readOperation(
  context: ToolsContext,
  name: string,
  path?: string,
):
  | ReadResult
  | {
      ok: false;
      error: "unknown_skill";
      detail: string;
    } {
  const { options, catalog, byName } = context;
  const entry = byName(name);
  if (!entry) return { ok: false, error: "unknown_skill", detail: name };
  return readSkillFile(entry, path);
}
