import type { HookInput, ShellStep } from "../contract.js";

export interface ShellCall {
  readonly command: string;

  readonly steps: readonly ShellStep[] | undefined;
}

export function shellCall(input: HookInput): ShellCall | null {
  if (input.tool?.kind !== "shell") return null;
  const command = input.tool.command ?? "";
  if (command.trim() === "") return null;
  return { command, steps: input.tool.steps };
}

export function program(word: string | undefined): string {
  if (!word) return "";
  const slash = word.lastIndexOf("/");
  return slash < 0 ? word : word.slice(slash + 1);
}

export function realSteps(steps: readonly ShellStep[]): readonly ShellStep[] {
  return steps.filter((step) => step.argv.length > 0);
}
