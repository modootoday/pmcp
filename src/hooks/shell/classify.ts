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

export function mutates(
  words: readonly string[],
  scripts: readonly RegExp[] = [],
): boolean {
  const [name = "", sub = ""] = words;
  if (name === "git") {
    const call = gitCall(words);
    if (GIT_MUTATING.has(call.sub)) return true;
    return (
      call.sub === "worktree" && ["add", "remove", "move"].includes(call.next)
    );
  }
  if (touchesLock(words, scripts)) return true;
  if (name === "bun" && sub === "run")
    return /^(git:|docker:|deploy|release|publish)/u.test(words[2] ?? "");
  if (["npm", "pnpm", "yarn"].includes(name)) return PACKAGE_MUTATING.has(sub);
  if (name === "docker") return DOCKER_MUTATING.has(sub);
  if (name === "wrangler") return WRANGLER_MUTATING.has(sub);
  return false;
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
    mutating: real.some((entry) => mutates(entry.argv, scripts)),
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
