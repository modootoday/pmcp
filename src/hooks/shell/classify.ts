// Classify executed commands so quoted mentions cannot be mistaken for operations.

import { commandsOf, gitCall } from "./commands.js";
import {
  BUN_INSTALLS,
  DOCKER_MUTATING,
  GIT_MUTATING,
  PACKAGE_MUTATING,
  WRANGLER_MUTATING,
} from "./vocabulary.js";

export { commandsOf, gitCall } from "./commands.js";

// Scripts that change the checkout (a project's own land or sync script) are project data from
// pmcp.toml, matched against the script node runs; the package itself names none.
function runsScript(
  words: readonly string[],
  scripts: readonly RegExp[],
): boolean {
  return (
    words[0] === "node" &&
    words.slice(1).some((word) => scripts.some((script) => script.test(word)))
  );
}

function touchesLock(
  words: readonly string[],
  scripts: readonly RegExp[],
): boolean {
  if (words[0] === "bun" && BUN_INSTALLS.has(words[1] ?? "")) return true;
  if (
    words[0] === "bun" &&
    words[1] === "run" &&
    /^git:(land|sync)$/u.test(words[2] ?? "")
  )
    return true;
  return runsScript(words, scripts);
}

// Beyond git and the package managers, what counts as changing shared state is project data:
// [sessions.pause] commands (argv prefixes) and script_names (package script names run with
// `<package manager> run`) replace these defaults.
export const DEFAULT_MUTATING_COMMANDS: readonly (readonly string[])[] = [
  ...[...DOCKER_MUTATING].map((verb) => ["docker", verb]),
  ...[...WRANGLER_MUTATING].map((verb) => ["wrangler", verb]),
];
export const DEFAULT_MUTATING_SCRIPT_NAMES: readonly string[] = [
  "^git:",
  "^docker:",
  "^deploy",
  "^release",
  "^publish",
];

export interface MutatingRules {
  // node scripts that change the checkout.
  readonly scripts: readonly RegExp[];
  readonly commands: readonly (readonly string[])[];
  readonly scriptNames: readonly RegExp[];
}

export const DEFAULT_MUTATING_RULES: MutatingRules = {
  scripts: [],
  commands: DEFAULT_MUTATING_COMMANDS,
  scriptNames: DEFAULT_MUTATING_SCRIPT_NAMES.map(
    (source) => new RegExp(source, "u"),
  ),
};

const RUNNERS = new Set(["bun", "npm", "pnpm", "yarn"]);

export function mutates(
  words: readonly string[],
  rules: MutatingRules = DEFAULT_MUTATING_RULES,
): boolean {
  const [name = "", sub = ""] = words;
  if (name === "git") {
    const call = gitCall(words);
    if (GIT_MUTATING.has(call.sub)) return true;
    return (
      call.sub === "worktree" && ["add", "remove", "move"].includes(call.next)
    );
  }
  if (touchesLock(words, rules.scripts)) return true;
  if (RUNNERS.has(name) && sub === "run")
    return rules.scriptNames.some((pattern) => pattern.test(words[2] ?? ""));
  if (["npm", "pnpm", "yarn"].includes(name)) return PACKAGE_MUTATING.has(sub);
  return rules.commands.some(
    (prefix) =>
      prefix.length > 0 && prefix.every((word, at) => words[at] === word),
  );
}

export interface Classified {
  readonly mutating: boolean;
  readonly lockTouching: boolean;
  readonly bypass: boolean;

  readonly pushDirs: readonly string[][];
  readonly steps: readonly string[];
}

// Retain text fallback so unreadable shell syntax still reaches conservative guards.
export function classify(
  command: string,
  bypassVariables: readonly string[] = [],
  scripts: readonly RegExp[] = [],
): Classified | null {
  const commands = commandsOf(command);
  if (!commands) return null;
  const real = commands.filter((entry) => entry.argv.length > 0);
  const exported = (words: readonly string[]) =>
    words[0] === "export" &&
    words.some((word) => bypassVariables.includes(word.split("=")[0]!));
  return {
    mutating: real.some((entry) =>
      mutates(entry.argv, { ...DEFAULT_MUTATING_RULES, scripts }),
    ),
    lockTouching: real.some((entry) => touchesLock(entry.argv, scripts)),
    bypass: commands.some(
      (entry) =>
        entry.assigned.some((name) => bypassVariables.includes(name)) ||
        exported(entry.argv) ||
        (entry.argv[0] === "git" && entry.argv.includes("--no-verify")),
    ),
    pushDirs: real
      .filter(
        (entry) =>
          entry.argv[0] === "git" && gitCall(entry.argv).sub === "push",
      )
      .map((entry) => [entry.dir, gitCall(entry.argv).dir].filter(Boolean)),
    steps: real.map((entry) => entry.argv.join(" ")),
  };
}
