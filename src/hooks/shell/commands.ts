import type { ShellStep } from "../contract.js";
import { SEPARATORS, tokenize } from "./tokenize.js";
import { GIT_VALUE_OPTIONS, SHELLS, WRAPPERS } from "./vocabulary.js";

const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/u;

function unwrap(words: readonly string[]): {
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

export function commandsOf(script: string, depth = 0): ShellStep[] | null {
  if (depth > 4) return null;
  const parsed = tokenize(script);
  if (!parsed) return null;
  const found: ShellStep[] = [];
  let dir = "";
  let current: string[] = [];
  const close = (): boolean => {
    if (current.length === 0) return true;
    const raw = current;
    const { assigned, words } = unwrap(current);
    current = [];
    if (words.length === 0) {
      // Preserve bare wrappers because they can print values a policy must inspect.
      found.push({ argv: [], raw, assigned, dir });
      return true;
    }
    if (words[0] === "cd") {
      dir = words[1] ?? "";
      return true;
    }
    const scriptAt = SHELLS.has(words[0]!)
      ? words.findIndex((word) => /^-[a-z]*c$/u.test(word))
      : -1;
    if (scriptAt > 0 || words[0] === "eval") {
      const source =
        words[0] === "eval"
          ? words.slice(1).join(" ")
          : (words[scriptAt + 1] ?? "");
      const inner = commandsOf(source, depth + 1);
      if (!inner) return false;
      found.push(
        ...inner.map((step) => ({
          ...step,
          assigned: [...assigned, ...step.assigned],
        })),
      );
      return true;
    }
    found.push({ argv: words, raw, assigned, dir });
    return true;
  };
  for (const token of parsed.tokens) {
    if (!SEPARATORS.has(token)) {
      current.push(token);
      continue;
    }
    if (!close()) return null;
  }
  if (!close()) return null;
  for (const nested of parsed.nested) {
    const inner = commandsOf(nested, depth + 1);
    if (!inner) return null;
    found.push(...inner);
  }
  return found;
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
