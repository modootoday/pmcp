import { program, realSteps, shellCall } from "../_shared.js";
import { noOptions, pass, type Policy } from "../types.js";

// Parse flag position because compose uses the same short option for different meanings.
const GLOBAL_VALUE_FLAGS = new Set([
  "-f",
  "--file",
  "-p",
  "--project-name",
  "--project-directory",
  "--profile",
  "--env-file",
  "-H",
  "--host",
  "--ansi",
  "--progress",
  "--parallel",
]);
const VERB_VALUE_FLAGS: Readonly<Record<string, ReadonlySet<string>>> = {
  stop: new Set(["-t", "--timeout"]),
  kill: new Set(["-s", "--signal"]),
  rm: new Set(),
  down: new Set(["-t", "--timeout", "--rmi"]),
};
const SCOPED_VERBS = new Set(["stop", "rm", "kill"]);
const FALLBACK =
  /\b(?:docker[ \t]+compose|docker-compose)\b[^|;&]*\b(?:down|stop|rm|kill)\b/u;

function firstArgument(
  words: readonly string[],
  valueFlags: ReadonlySet<string>,
): { value: string | null; rest: readonly string[] } {
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index]!;
    if (!word.startsWith("-"))
      return { value: word, rest: words.slice(index + 1) };
    if (!word.includes("=") && valueFlags.has(word)) index += 1;
  }
  return { value: null, rest: [] };
}

function composeArgs(argv: readonly string[]): readonly string[] | null {
  const name = program(argv[0]);
  if (name === "docker-compose") return argv.slice(1);
  if (name === "docker" && argv[1] === "compose") return argv.slice(2);
  return null;
}

export function teardownReason(argv: readonly string[]): string | null {
  const args = composeArgs(argv);
  if (!args) return null;
  const { value: verb, rest } = firstArgument(args, GLOBAL_VALUE_FLAGS);
  if (verb === "down") {
    return "docker compose down takes no service argument: it tears down every container and network in the project, including ones this task never touched.";
  }
  if (!verb || !SCOPED_VERBS.has(verb)) return null;
  if (firstArgument(rest, VERB_VALUE_FLAGS[verb]!).value) return null;
  return `docker compose ${verb} with no service named applies to every service in the project. Name the service you mean.`;
}

export const composeTeardown: Policy<object> = {
  id: "shell.compose_teardown",
  events: ["before_tool"],
  tools: ["shell"],
  fail: "closed",
  defaultMode: "deny",
  options: noOptions,
  evaluate(input) {
    const call = shellCall(input);
    if (!call) return pass;
    if (!call.steps) {
      if (!FALLBACK.test(call.command)) return pass;
      return {
        verdict: "deny",
        reason: "A docker compose teardown could not be read.",
      };
    }
    for (const step of realSteps(call.steps)) {
      const reason = teardownReason(step.argv);
      if (reason) return { verdict: "deny", reason };
    }
    return pass;
  },
};
