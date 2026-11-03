import type { HookInput } from "../contract.js";
import { readScript } from "../shell/classify.js";

export function withSteps(input: HookInput): HookInput {
  const tool = input.tool;
  if (tool?.kind !== "shell" || !tool.command) return input;
  const read = readScript(tool.command);
  if ("error" in read)
    return { ...input, tool: { ...tool, syntaxError: read.error } };
  return {
    ...input,
    tool: { ...tool, steps: read.steps, redirects: read.redirects },
  };
}
