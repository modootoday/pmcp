import { program, realSteps, shellCall } from "../_shared.js";
import { noOptions, pass, type Policy } from "../types.js";

const EDITORS = new Set(["sed", "perl", "awk", "gawk"]);

const FALLBACK =
  /(^|[;&|\n]|&&)[ \t]*(?:[A-Za-z_][A-Za-z0-9_]*=\S*[ \t]+)*(sed|perl|gawk|awk)\b[^\n]*?\s(-i\b|--in-place\b|-i\S+)/u;
const REASON =
  "In-place stream edits (sed -i, perl -i, awk -i) rewrite files without showing a diff and succeed on the first match rather than the intended one. Use the editor tool instead.";

function inPlace(argv: readonly string[]): boolean {
  const name = program(argv[0]);
  if (!EDITORS.has(name)) return false;
  // Recognize clustered flags because sed and perl accept in-place options within them.
  const cluster = name === "sed" || name === "perl" ? /^-[A-Za-z]*i/u : /^-i/u;
  return argv
    .slice(1)
    .some((arg) => arg.startsWith("--in-place") || cluster.test(arg));
}

export const inPlaceEdit: Policy<object> = {
  id: "shell.in_place_edit",
  events: ["before_tool"],
  tools: ["shell"],
  fail: "closed",
  defaultMode: "deny",
  options: noOptions,
  evaluate(input) {
    const call = shellCall(input);
    if (!call) return pass;
    const hit = call.steps
      ? realSteps(call.steps).some((step) => inPlace(step.argv))
      : FALLBACK.test(call.command);
    return hit ? { verdict: "deny", reason: REASON } : pass;
  },
};
