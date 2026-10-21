import { program, realSteps, shellCall } from "../_shared.js";
import { noOptions, pass, type Policy } from "../types.js";

const PYTHON = /^i?python[23]?(\.\d+)?$/u;
const FALLBACK =
  /(?:^|[;&|(]|&&|\|\|)[ \t]*(?:sudo[ \t]+)?i?python[23]?(?:\.\d+)?\b([^;&|)]*)/gu;
const REASON =
  "This interpreter reads its program from stdin, so the command text does not contain it and whatever fed the pipe already expanded it. Write the script with the editor tool, then run it.";

function programFromStdin(args: readonly string[]): boolean {
  if (args.includes("-")) return true;
  return !args.some(
    (arg) => arg === "-c" || arg === "-m" || !arg.startsWith("-"),
  );
}

function fallback(command: string): boolean {
  for (const match of command.matchAll(FALLBACK)) {
    const args = (match[1] ?? "").trim().split(/\s+/u).filter(Boolean);
    if (programFromStdin(args)) return true;
  }
  return false;
}

export const stdinInterpreter: Policy<object> = {
  id: "shell.stdin_interpreter",
  events: ["before_tool"],
  tools: ["shell"],
  fail: "closed",
  defaultMode: "ask",
  options: noOptions,
  evaluate(input) {
    const call = shellCall(input);
    if (!call) return pass;
    const hit = call.steps
      ? realSteps(call.steps).some(
          (step) =>
            PYTHON.test(program(step.argv[0])) &&
            programFromStdin(step.argv.slice(1)),
        )
      : fallback(call.command);
    return hit ? { verdict: "deny", reason: REASON } : pass;
  },
};
