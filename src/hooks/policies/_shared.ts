import type { HookInput, ShellRedirect, ShellStep } from "../contract.js";
import { readScript } from "../shell/classify.js";

export interface ShellCall {
  readonly command: string;

  readonly steps: readonly ShellStep[];

  readonly redirects: readonly ShellRedirect[];
}

// A command the shell would refuse cannot be judged; the guard fails, and its fail mode decides.
export class UnreadableCommand extends Error {
  constructor(reason: string) {
    super(`not shell syntax: ${reason}`);
  }
}

export function shellCall(input: HookInput): ShellCall | null {
  if (input.tool?.kind !== "shell") return null;
  const command = input.tool.command ?? "";
  if (command.trim() === "") return null;
  const { steps, redirects, syntaxError } = input.tool;
  if (steps) return { command, steps, redirects: redirects ?? [] };
  // Callers that skipped enrichment still get the command read, never guessed at.
  const read = readScript(command);
  if ("error" in read) throw new UnreadableCommand(syntaxError ?? read.error);
  return { command, steps: read.steps, redirects: read.redirects };
}

export function program(word: string | undefined): string {
  if (!word) return "";
  const slash = word.lastIndexOf("/");
  return slash < 0 ? word : word.slice(slash + 1);
}

export function realSteps(steps: readonly ShellStep[]): readonly ShellStep[] {
  return steps.filter((step) => step.argv.length > 0);
}
