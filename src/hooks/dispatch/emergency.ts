import { existsSync } from "node:fs";
import { resolve } from "node:path";

import type { Decision, HookInput } from "../contract.js";
import { expandPath } from "../../sessions/paths.js";

// Allow only reads of the emergency switch so tools cannot silently disable enforcement.
const READ_ONLY = new Set([
  "cat",
  "ls",
  "stat",
  "test",
  "[",
  "head",
  "tail",
  "wc",
  "file",
]);
const REASON =
  "The emergency off switch belongs to the operator; agents may not create, change or delete it.";

export function emergencyActive(
  root: string,
  file: string | undefined,
): boolean {
  return file !== undefined && existsSync(expandPath(root, file));
}

export function protectOffFile(
  input: HookInput,
  file: string | undefined,
): Decision {
  const tool = input.tool;
  if (!file || input.event !== "before_tool" || !tool) return {};
  const target = expandPath(input.projectRoot, file);
  if (tool.kind === "edit") {
    return tool.paths.some((path) => resolve(path) === target)
      ? { verdict: "deny", reason: REASON }
      : {};
  }
  if (tool.kind !== "shell") return {};
  if (!tool.steps) {
    return (tool.command ?? "").includes(file)
      ? { verdict: "deny", reason: REASON }
      : {};
  }
  const names = tool.steps.some(
    (step) =>
      !READ_ONLY.has(step.argv[0] ?? "") &&
      step.raw.some(
        (word) =>
          word === file ||
          expandPath(resolve(input.cwd, step.dir), word) === target,
      ),
  );
  return names ? { verdict: "deny", reason: REASON } : {};
}
