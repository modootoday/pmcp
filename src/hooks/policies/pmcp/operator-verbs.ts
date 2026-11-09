import type { ShellStep } from "../../contract.js";
import { program, shellCall } from "../_shared.js";
import { noOptions, pass, type Policy } from "../types.js";

// The verbs that govern the sessions belong to the operator. The CLI refuses them outside the
// operator's terminal too; this guard stops the attempt in the agent's own runtime first.

const GLOBAL = new Set(["-q", "--quiet", "--color", "--no-color"]);
// Variables that carry an operator act: an emergency run, or the operator's credential.
const VARIABLES = ["PMCP_HEAVY_NOW", "PMCP_OPERATOR_TOKEN"];

function launcher(word: string): boolean {
  const name = program(word);
  return (
    name === "pmcp" ||
    name === "cli.js" ||
    /^@modootoday\/pmcp(@|$)/u.test(word)
  );
}

const RUNNERS = new Set(["npx", "bunx", "pnpx", "node", "bun", "pnpm", "yarn"]);

// The words pmcp itself reads, after its launcher and global flags, up to a bare --.
function pmcpWords(argv: readonly string[]): string[] | null {
  const reach = RUNNERS.has(program(argv[0])) ? 4 : 1;
  const at = argv.slice(0, reach).findIndex(launcher);
  if (at < 0) return null;
  const words = argv.slice(at + 1).filter((word) => !GLOBAL.has(word));
  const cut = words.indexOf("--");
  return cut < 0 ? words : words.slice(0, cut);
}

function verb(words: readonly string[]): string | null {
  const [group, sub] = words;
  const has = (flag: string) => words.includes(flag);
  if (group === "sessions" && (sub === "pause" || sub === "resume"))
    return `pmcp sessions ${sub}`;
  if (group === "heavy" && sub === "promote" && has("--now"))
    return "pmcp heavy promote --now";
  if (group === "heavy" && has("--now")) return "pmcp heavy --now";
  if (group === "heavy" && sub === "cancel" && has("--force"))
    return "pmcp heavy cancel --force";
  if (group === "git" && sub === "deliver" && has("--during-pause"))
    return "pmcp git deliver --during-pause";
  return null;
}

function assigns(step: ShellStep): string | null {
  const name = step.assigned.find((entry) => VARIABLES.includes(entry));
  if (name) return name;
  if (program(step.argv[0]) !== "export") return null;
  return (
    VARIABLES.find((variable) =>
      step.argv.some((word) => word.split("=")[0] === variable),
    ) ?? null
  );
}

function found(step: ShellStep): string | null {
  const variable = assigns(step);
  if (variable) return `setting ${variable}`;
  const words = pmcpWords(step.argv);
  return words ? verb(words) : null;
}

export const operatorVerbs: Policy<object> = {
  id: "pmcp.operator_verbs",
  events: ["before_tool"],
  tools: ["shell"],
  fail: "closed",
  defaultMode: "deny",
  options: noOptions,
  evaluate(input) {
    const call = shellCall(input);
    if (!call) return pass;
    for (const step of call.steps) {
      const what = found(step);
      if (what)
        return {
          verdict: "deny",
          reason: `${what} is the operator's to run, not an agent session's. Ask the operator to run it from their own terminal, and say why.`,
        };
    }
    return pass;
  },
};
