import { shellCall } from "../_shared.js";
import { noOptions, pass, type Policy } from "../types.js";

const HERE = new Set(["<<", "<<-", "<<<"]);
const REASON =
  "Heredocs and here-strings are refused: the shell expands and truncates their body silently. Write the file with the editor tool, then run it, or pass the content as an argument.";

export const heredoc: Policy<object> = {
  id: "shell.heredoc",
  events: ["before_tool"],
  tools: ["shell"],
  fail: "closed",
  defaultMode: "deny",
  options: noOptions,
  evaluate(input) {
    const call = shellCall(input);
    if (!call) return pass;
    return call.redirects.some((redirect) => HERE.has(redirect.op))
      ? { verdict: "deny", reason: REASON }
      : pass;
  },
};
