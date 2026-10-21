import type { HookInput } from "../contract.js";
import { commandsOf } from "../shell/classify.js";

export function withSteps(input: HookInput): HookInput {
  const tool = input.tool;
  if (tool?.kind !== "shell" || !tool.command) return input;
  const steps = commandsOf(tool.command);
  if (!steps) return input;
  return { ...input, tool: { ...tool, steps } };
}
