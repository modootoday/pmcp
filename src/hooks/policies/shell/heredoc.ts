import { shellCall } from "../_shared.js";
import { noOptions, pass, type Policy } from "../types.js";

// Exclude here-strings and process substitution so the heredoc guard does not misclassify them.
const HEREDOC = /<<(?!<)-?[ \t]*(['"\\]?)[A-Za-z_][A-Za-z0-9_]*\1/u;
const HERESTRING = /<<</u;
const REASON =
  "Heredocs and here-strings are refused: the shell expands and truncates their body silently. Write the file with the editor tool, then run it, or pass the content as an argument.";

// Mask quoted text so messages mentioning heredocs do not trigger execution guards.
export function maskQuotes(command: string): string | null {
  let out = "";
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index]!;
    if (char === "\\") {
      out += command.slice(index, index + 2);
      index += 1;
      continue;
    }
    if (char !== "'" && char !== '"') {
      out += char;
      continue;
    }
    let end = index + 1;
    while (end < command.length && command[end] !== char) {
      end += char === '"' && command[end] === "\\" ? 2 : 1;
    }
    if (end >= command.length) return null;
    out += "Q";
    index = end;
  }
  return out;
}

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
    // Keep unbalanced input visible so malformed shell text still fails closed.
    const text = maskQuotes(call.command) ?? call.command;
    if (HEREDOC.test(text) || HERESTRING.test(text)) {
      return { verdict: "deny", reason: REASON };
    }
    return pass;
  },
};
