import { program, realSteps, shellCall } from "../_shared.js";
import { noOptions, pass, type Policy } from "../types.js";

const PYTHON = /^i?python[23]?(\.\d+)?$/u;
const REASON =
  "This interpreter reads its program from stdin, so the command text does not contain it and whatever fed the pipe already expanded it. Write the script with the editor tool, then run it.";

// --version, -V, --help and the like print and exit before any program is read.
const INFORMATIONAL = /^(?:-V+|--version|-h|-\?|--help(?:-[a-z]+)?)$/u;

// Redirections are not arguments, so python3 < x.py has none and reads x.py from stdin.
function programFromStdin(args: readonly string[]): boolean {
  if (args.includes("-")) return true;
  if (args.some((arg) => INFORMATIONAL.test(arg))) return false;
  return !args.some(
    (arg) => arg === "-c" || arg === "-m" || !arg.startsWith("-"),
  );
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
    const hit = realSteps(call.steps).some(
      (step) =>
        PYTHON.test(program(step.argv[0])) &&
        programFromStdin(step.argv.slice(1)),
    );
    return hit ? { verdict: "deny", reason: REASON } : pass;
  },
};
