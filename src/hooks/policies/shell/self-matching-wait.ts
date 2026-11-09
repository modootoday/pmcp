import type { Command, List, Word } from "../../shell/parse/ast.js";
import { parseScript, ShellSyntaxError } from "../../shell/parse/parser.js";
import { unwrap } from "../../shell/commands.js";
import { SHELLS } from "../../shell/vocabulary.js";
import { program, shellCall } from "../_shared.js";
import { noOptions, pass, type Policy } from "../types.js";

// A probe that matches full command lines also matches the shell running the loop, whose own
// command line holds the pattern, so the wait never ends.
const MENTIONS = /\b(?:pgrep|pkill|pidwait|ps)\b/u;
const LOOPS = new Set(["while", "until", "for", "select"]);
const FULL_MATCHERS = new Set(["pgrep", "pkill", "pidwait"]);
const GREPS = new Set(["grep", "egrep", "fgrep", "rg"]);
const MAX_DEPTH = 4;

const reason = (probe: string) =>
  `This loop polls with ${probe}, whose pattern also matches the shell running the loop (its command line holds the pattern), so the wait may never end. Wait on a process id with pmcp wait --pid <pid>, on a process by its text with pmcp wait --until no-process:<text> (it never matches itself), or on a queued job with pmcp heavy wait <ticket>.`;

function fullMatch(argv: readonly string[]): boolean {
  return argv
    .slice(1)
    .some(
      (arg) =>
        arg === "--full" || (/^-[a-zA-Z]+$/u.test(arg) && arg.includes("f")),
    );
}

// ps limited to given pids or command names lists no full command line of its own shell.
function psBySelection(argv: readonly string[]): boolean {
  return argv
    .slice(1)
    .some(
      (arg) =>
        /^-[a-zA-Z]*[pqC]/u.test(arg) ||
        /^--(?:pid|quick-pid)(?:=|$)/u.test(arg),
    );
}

function argvOf(command: Command): string[] | null {
  if (command.kind !== "simple") return null;
  return unwrap(command.words.map((word) => word.text)).words;
}

function pipeProbe(commands: readonly Command[]): string | null {
  const argvs = commands.map(argvOf);
  const ps = argvs.findIndex(
    (argv) => argv && program(argv[0]) === "ps" && !psBySelection(argv),
  );
  if (ps < 0) return null;
  const grep = argvs
    .slice(ps + 1)
    .some((argv) => argv && GREPS.has(program(argv[0])));
  return grep ? "ps | grep" : null;
}

class Finder {
  probe: string | null = null;

  list(list: List, looping: boolean, depth: number): void {
    for (const item of list)
      for (const pipeline of item.pipelines) {
        if (looping) this.probe ??= pipeProbe(pipeline.commands);
        for (const command of pipeline.commands)
          this.command(command, looping, depth);
      }
  }

  private words(words: readonly Word[], looping: boolean, depth: number) {
    for (const word of words)
      for (const nested of word.nested) this.list(nested, looping, depth);
  }

  private command(command: Command, looping: boolean, depth: number): void {
    switch (command.kind) {
      case "simple":
        this.words([...command.assigns, ...command.words], looping, depth);
        this.simple(command, looping, depth);
        return;
      case "group":
      case "subshell":
        this.list(command.body, looping, depth);
        return;
      case "compound": {
        // A for loop's items expand once, before it starts polling.
        this.words(command.words, looping, depth);
        const loop = looping || LOOPS.has(command.keyword);
        for (const part of command.parts) this.list(part, loop, depth);
        return;
      }
      case "function":
        this.command(command.body, looping, depth);
    }
  }

  private simple(
    command: Extract<Command, { kind: "simple" }>,
    looping: boolean,
    depth: number,
  ): void {
    const argv = argvOf(command) ?? [];
    const name = program(argv[0]);
    if (looping && FULL_MATCHERS.has(name) && fullMatch(argv))
      this.probe ??= `${name} -f`;
    const at = SHELLS.has(name)
      ? argv.findIndex((word) => /^-[a-z]*c$/u.test(word))
      : -1;
    if ((at > 0 || name === "eval") && depth < MAX_DEPTH) {
      const source =
        name === "eval" ? argv.slice(1).join(" ") : (argv[at + 1] ?? "");
      try {
        this.list(parseScript(source), looping, depth + 1);
      } catch (error) {
        if (!(error instanceof ShellSyntaxError)) throw error;
      }
    }
  }
}

export const selfMatchingWait: Policy<object> = {
  id: "shell.self_matching_wait",
  events: ["before_tool"],
  tools: ["shell"],
  fail: "closed",
  defaultMode: "observe",
  options: noOptions,
  evaluate(input) {
    if (!MENTIONS.test(input.tool?.command ?? "")) return pass;
    const call = shellCall(input);
    if (!call) return pass;
    const finder = new Finder();
    finder.list(parseScript(call.command), false, 0);
    return finder.probe
      ? { verdict: "deny", reason: reason(finder.probe) }
      : pass;
  },
};
