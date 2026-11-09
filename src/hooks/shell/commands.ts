import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

import type { ShellRedirect, ShellStep } from "../contract.js";
import type { Command, List, Redirect, Word } from "./parse/ast.js";
import { parseScript, ShellSyntaxError } from "./parse/parser.js";
import { GIT_VALUE_OPTIONS, SHELLS, WRAPPERS } from "./vocabulary.js";

const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/u;
const MAX_DEPTH = 4;
// A for loop is walked once per item up to these bounds, and once with its variable unknown past them.
const MAX_ITEMS = 32;
const MAX_UNROLLED = 128;

export function unwrap(words: readonly string[]): {
  assigned: string[];
  words: string[];
} {
  const assigned: string[] = [];
  let rest = [...words];
  for (;;) {
    if (rest.length > 0 && ASSIGNMENT.test(rest[0]!)) {
      assigned.push(rest[0]!.split("=")[0]!);
      rest = rest.slice(1);
      continue;
    }
    if (rest.length > 0 && WRAPPERS.has(rest[0]!)) {
      rest = rest.slice(1);
      while (
        rest.length > 0 &&
        (rest[0]!.startsWith("-") || /^\d+[smhd]?$/u.test(rest[0]!))
      ) {
        rest = rest.slice(1);
      }
      continue;
    }
    return { assigned, words: rest };
  }
}

const DECLARES = new Set(["export", "declare", "local", "readonly", "typeset"]);

// The directory a shell is in ("" is where the command started), the one before, pushd's stack,
// the variables the script set to plain text, and the names it exported.
interface Place {
  dir: string;
  previous: string;
  stack: string[];
  vars: Map<string, string>;
  exported: Set<string>;
}

function start(): Place {
  return {
    dir: "",
    previous: "",
    stack: [],
    vars: new Map([["HOME", homedir()]]),
    exported: new Set(["HOME"]),
  };
}

// A subshell copies everything.
function fork(place: Place): Place {
  return {
    ...place,
    stack: [...place.stack],
    vars: new Map(place.vars),
    exported: new Set(place.exported),
  };
}

// A new shell process starts where its parent is, with the exported variables and the
// NAME=value words before its command.
function child(place: Place, prefix: readonly Word[]): Place {
  const next = fork(place);
  next.stack = [];
  for (const name of next.vars.keys())
    if (!next.exported.has(name)) next.vars.delete(name);
  assign(next, prefix, true);
  return next;
}

// The word with each $NAME the shell expands replaced where the script set NAME to plain text.
function expanded(word: Word, vars: ReadonlyMap<string, string>): string {
  let text = word.text;
  for (const param of [...word.params].reverse()) {
    const value = vars.get(param.name);
    if (value !== undefined)
      text = text.slice(0, param.start) + value + text.slice(param.end);
  }
  return text;
}

function changeDir(place: Place, target: string | undefined): string {
  if (target === undefined || target === "~") return homedir();
  if (target.startsWith("~/")) return join(homedir(), target.slice(2));
  if (isAbsolute(target) || place.dir === "") return target;
  return join(place.dir, target);
}

// Assignments take effect left to right; a value with a substitution or an unknown variable is unknown.
function assign(
  place: Place,
  assigns: readonly Word[],
  exporting: boolean,
): void {
  for (const word of assigns) {
    const name = /^([A-Za-z_][A-Za-z0-9_]*)=/u.exec(word.text)?.[1];
    if (!name) continue;
    if (exporting) place.exported.add(name);
    const value = expanded(word, place.vars).slice(name.length + 1);
    // Any $ left is an expansion the walk does not evaluate, such as ${NAME:-x} or $1.
    const known =
      word.nested.length === 0 &&
      word.params.every((param) => place.vars.has(param.name)) &&
      !value.includes("$");
    if (known) place.vars.set(name, value);
    else place.vars.delete(name);
  }
}

function go(place: Place, dir: string): void {
  place.previous = place.dir;
  place.dir = dir;
}

function move(place: Place, argv: readonly string[]): void {
  const args = argv.slice(1).filter((word) => !/^-[LPe@]+$/u.test(word));
  const target = args[0] === "--" ? args[1] : args[0];
  if (argv[0] === "popd") {
    const back = place.stack.pop();
    if (back !== undefined) go(place, back);
    return;
  }
  if (argv[0] === "pushd") {
    if (target === undefined) return;
    place.stack.push(place.dir);
  }
  go(place, target === "-" ? place.previous : changeDir(place, target));
}

class Walk {
  readonly found: ShellStep[] = [];
  readonly redirects: ShellRedirect[] = [];
  // Loop bodies walked once per item so far; nested loops would otherwise multiply.
  private unrolled = 0;

  list(items: List, place: Place, depth: number): void {
    for (const item of items) {
      // A background job runs in a subshell; its cd stays there.
      const here = item.background ? fork(place) : place;
      for (const pipeline of item.pipelines) {
        const alone = pipeline.commands.length === 1;
        for (const command of pipeline.commands)
          this.command(command, alone ? here : fork(here), depth);
      }
    }
  }

  private command(command: Command, place: Place, depth: number): void {
    switch (command.kind) {
      case "simple":
        this.simple(command, place, depth);
        return;
      case "group":
        this.list(command.body, place, depth);
        this.redirected(command.redirects, place, depth);
        return;
      case "subshell":
        this.list(command.body, fork(place), depth);
        this.redirected(command.redirects, place, depth);
        return;
      case "compound": {
        this.expansions(command.words, place, depth);
        const items =
          command.keyword === "for" ? literalItems(command, place) : null;
        if (
          items &&
          command.variable &&
          this.unrolled + items.length <= MAX_UNROLLED
        ) {
          this.unrolled += items.length;
          for (const item of items) {
            place.vars.set(command.variable, item);
            for (const part of command.parts) this.list(part, place, depth);
          }
        } else {
          // A loop variable takes values the walk does not follow.
          if (command.variable) place.vars.delete(command.variable);
          for (const part of command.parts) this.list(part, place, depth);
        }
        this.redirected(command.redirects, place, depth);
        return;
      }
      case "function":
        this.command(command.body, fork(place), depth);
    }
  }

  private redirected(
    redirects: readonly Redirect[],
    place: Place,
    depth: number,
  ): ShellRedirect[] {
    this.expansions(redirectWords(redirects), place, depth);
    const plain = redirects.map(({ op, fd, target }) => ({
      op,
      fd,
      target: expanded(target, place.vars),
    }));
    this.redirects.push(...plain);
    return plain;
  }

  // What a simple command does to this shell's variables.
  private settle(
    command: Extract<Command, { kind: "simple" }>,
    place: Place,
  ): void {
    // A bare NAME=value stays in this shell; NAME=value before a command reaches only that command.
    if (command.words.length === 0) {
      assign(place, command.assigns, false);
      return;
    }
    const [name, ...args] = command.words.map((word) => word.text);
    if (DECLARES.has(name!)) {
      const exporting = name === "export";
      assign(place, command.words.slice(1), exporting);
      if (exporting)
        for (const arg of args)
          if (/^[A-Za-z_][A-Za-z0-9_]*$/u.test(arg)) place.exported.add(arg);
    }
    if (name === "read")
      for (const arg of args)
        if (/^[A-Za-z_][A-Za-z0-9_]*$/u.test(arg)) place.vars.delete(arg);
  }

  // Substitutions run in subshells that start where the command is.
  private expansions(
    words: readonly Word[],
    place: Place,
    depth: number,
  ): void {
    for (const word of words)
      for (const nested of word.nested) this.list(nested, fork(place), depth);
  }

  private simple(
    command: Extract<Command, { kind: "simple" }>,
    place: Place,
    depth: number,
  ): void {
    const written = [...command.assigns, ...command.words];
    this.expansions(written, place, depth);
    const redirects = this.redirected(command.redirects, place, depth);
    if (written.length === 0) return;
    const raw = written.map((word) => expanded(word, place.vars));
    this.settle(command, place);
    const { assigned, words } = unwrap(raw);
    if (words.length === 0) {
      // Preserve bare wrappers because they can print values a policy must inspect.
      this.found.push({ argv: [], raw, assigned, dir: place.dir, redirects });
      return;
    }
    if (["cd", "pushd", "popd"].includes(words[0]!)) {
      move(place, words);
      return;
    }
    const scriptAt = SHELLS.has(words[0]!)
      ? words.findIndex((word) => /^-[a-z]*c$/u.test(word))
      : -1;
    if (scriptAt > 0 || words[0] === "eval") {
      if (depth >= MAX_DEPTH)
        throw new ShellSyntaxError("shell nested too deep", 0);
      const source =
        words[0] === "eval"
          ? words.slice(1).join(" ")
          : (words[scriptAt + 1] ?? "");
      const inner = new Walk();
      inner.list(parseScript(source), child(place, command.assigns), depth + 1);
      this.redirects.push(...inner.redirects);
      this.found.push(
        ...inner.found.map((step) => ({
          ...step,
          assigned: [...assigned, ...step.assigned],
        })),
      );
      return;
    }
    this.found.push({ argv: words, raw, assigned, dir: place.dir, redirects });
  }
}

// The values a for loop assigns, when each item is plain text the shell neither splits nor
// globs; null when the walk cannot tell them, such as "for x" over the arguments or a $(...) item.
function literalItems(
  command: Extract<Command, { kind: "compound" }>,
  place: Place,
): string[] | null {
  if (command.words.length === 0 || command.words.length > MAX_ITEMS)
    return null;
  const items: string[] = [];
  for (const word of command.words) {
    if (word.nested.length > 0 || word.params.length > 0) return null;
    if (/[*?[{$]/u.test(word.text)) return null;
    items.push(expanded(word, place.vars));
  }
  return items;
}

function redirectWords(redirects: readonly Redirect[]): Word[] {
  return redirects.flatMap((redirect) =>
    redirect.body ? [redirect.target, redirect.body] : [redirect.target],
  );
}

export type ReadScript =
  | {
      readonly steps: readonly ShellStep[];
      // Every redirection the script makes, compound commands' included.
      readonly redirects: readonly ShellRedirect[];
    }
  | { readonly error: string };

export function readScript(script: string): ReadScript {
  const walk = new Walk();
  try {
    walk.list(parseScript(script), start(), 0);
  } catch (error) {
    if (error instanceof ShellSyntaxError) return { error: error.message };
    throw error;
  }
  return { steps: walk.found, redirects: walk.redirects };
}

// Every command the script would run, in order, with the directory it runs in; null when the
// shell would refuse the script.
export function commandsOf(script: string): ShellStep[] | null {
  const read = readScript(script);
  return "error" in read ? null : [...read.steps];
}

export function gitCall(words: readonly string[]): {
  sub: string;
  next: string;
  at: number;
  dir: string;
} {
  let index = 1;
  let dir = "";
  while (index < words.length && words[index]!.startsWith("-")) {
    const option = words[index]!.split("=")[0]!;
    if (GIT_VALUE_OPTIONS.has(option) && !words[index]!.includes("=")) {
      if (option === "-C") dir = words[index + 1] ?? "";
      index += 2;
      continue;
    }
    index += 1;
  }
  return {
    sub: words[index] ?? "",
    next: words[index + 1] ?? "",
    at: index,
    dir,
  };
}
