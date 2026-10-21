import { bundleSkill, type SkillBundle } from "../files/bundle.js";
import type { ToolsContext } from "./types.js";
export function bundleOperation(
  context: ToolsContext,
  name: string,
): SkillBundle | null {
  const { options, catalog, byName } = context;
  const entry = byName(name);
  return entry ? bundleSkill(entry) : null;
}
