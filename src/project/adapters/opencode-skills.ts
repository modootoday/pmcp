import type { ProjectSpec } from "../spec.js";
import { jsonOutput, type Output } from "../outputs.js";
import { OPENCODE_CONFIG } from "./opencode.js";

export function opencodeSkillOutputs(
  spec: ProjectSpec,
  names: readonly string[],
): Output[] {
  if (!spec.tools.has("opencode")) return [];
  return names
    .filter((name) => spec.skills[name]?.invocation === "user")
    .map((name) =>
      jsonOutput(OPENCODE_CONFIG, ["permission", "skill", name], "deny"),
    );
}
