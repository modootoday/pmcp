import { program, realSteps, shellCall } from "../_shared.js";
import { noOptions, pass, type Policy } from "../types.js";

const PYTHON = /^i?python[23]?(\.\d+)?$/u;
const FALLBACK =
  /(?:^|[;&|(]|&&|\|\|)[ \t]*(?:sudo[ \t]+)?i?python[23]?(?:\.\d+)?\b([^;&|)]*)/gu;
const REASON =
  "This interpreter reads its program from stdin, so the command text does not contain it and whatever fed the pipe already expanded it. Write the script with the editor tool, then run it.";

// --version, -V, --help and the like print and exit before any program is read.
const INFORMATIONAL = /^(?:-V+|--version|-h|-\?|--help(?:-[a-z]+)?)$/u;

// Redirections stay in a step's words; neither the operator nor its target is an argument, so
// `python3 < x.py` has no program argument and reads x.py as its program from stdin.
const REDIRECT = /^\d*(?:<|>>?|&>)(.*)$/u;

function withoutRedirects(args: readonly string[]): string[] {
  const kept: string[] = [];
  for (let at = 0; at < args.length; at += 1) {
    const match = REDIRECT.exec(args[at]!);
    if (!match) kept.push(args[at]!);
    else if (match[1] === "") at += 1;
  }
  return kept;
}

function programFromStdin(words: readonly string[]): boolean {
  const args = withoutRedirects(words);
  if (args.includes("-")) return true;
  if (args.some((arg) => INFORMATIONAL.test(arg))) return false;
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
