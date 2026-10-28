// What makes a grep pattern expensive. GNU grep compiles a counted repetition into a DFA whose
// size grows with the count, and a backtracking (-P) engine retries a quantified group inside a
// quantified group exponentially often; both can hold a core for minutes on large input.

export type Flavor = "basic" | "extended" | "perl";

export interface CostLimits {
  // The largest repetition count allowed, as m or n in {m,n}.
  readonly threshold: number;
  // Flag -o with more than one .* (opt-in: often harmless, sometimes slow on long lines).
  readonly onlyMatchingWildcards: boolean;
}

const BASIC_INTERVAL = /^\\\{(\d*)(?:,(\d*))?\\\}/u;
const INTERVAL = /^\{(\d*)(?:,(\d*))?\}/u;

// The repetition counts in a pattern: \{m,n\} in basic syntax, {m,n} in extended and perl.
export function repetitionCounts(pattern: string, flavor: Flavor): number[] {
  const counts: number[] = [];
  for (let at = 0; at < pattern.length; at += 1) {
    const char = pattern[at];
    if (char !== "\\" && char !== "{") continue;
    const shape = flavor === "basic" ? BASIC_INTERVAL : INTERVAL;
    const interval =
      char === "{" && flavor === "basic" ? null : shape.exec(pattern.slice(at));
    if (!interval) {
      if (char === "\\") at += 1;
      continue;
    }
    for (const bound of [interval[1], interval[2]])
      if (bound) counts.push(Number(bound));
    at += interval[0].length - 1;
  }
  return counts;
}

// A quantified group that holds a quantifier itself, (a+)+ or (.*)*: catastrophic backtracking
// in a backtracking engine. Character classes and escapes are skipped.
export function nestedQuantifier(pattern: string): boolean {
  const groups: boolean[] = [];
  let quantified = false;
  for (let at = 0; at < pattern.length; at += 1) {
    const char = pattern[at];
    if (char === "\\") {
      at += 1;
      continue;
    }
    if (char === "[") {
      at = classEnd(pattern, at);
      continue;
    }
    if (char === "(") {
      groups.push(quantified);
      quantified = false;
      continue;
    }
    if (char === ")") {
      const inner: boolean = quantified;
      quantified = groups.pop() ?? false;
      if (inner && repeats(pattern, at + 1)) return true;
      quantified ||= inner;
      continue;
    }
    if (repeats(pattern, at)) quantified = true;
  }
  return false;
}

// A quantifier that can repeat without bound starts at `at`: *, + or {m,}.
function repeats(pattern: string, at: number): boolean {
  const char = pattern[at];
  if (char === "*" || char === "+") return true;
  return char === "{" && /^\{\d*,\}/u.test(pattern.slice(at));
}

function classEnd(pattern: string, start: number): number {
  let at = start + 1;
  if (pattern[at] === "^") at += 1;
  if (pattern[at] === "]") at += 1;
  for (; at < pattern.length; at += 1) {
    if (pattern[at] === "\\") at += 1;
    else if (pattern[at] === "]") return at;
  }
  return pattern.length;
}

// Why a pattern is expensive, or null.
export function patternCost(
  pattern: string,
  flavor: Flavor,
  onlyMatching: boolean,
  limits: CostLimits,
): string | null {
  const largest = Math.max(0, ...repetitionCounts(pattern, flavor));
  if (largest > limits.threshold)
    return `a repetition count of ${largest} (the limit is ${limits.threshold}), whose cost is in compiling the pattern, so even an empty input holds the core`;
  if (flavor === "perl" && nestedQuantifier(pattern))
    return "a -P pattern with a quantified group inside a quantifier, such as (a+)+ or (.*)*";
  if (
    limits.onlyMatchingWildcards &&
    onlyMatching &&
    (pattern.match(/\.\*/gu) ?? []).length > 1
  )
    return "-o with more than one .*";
  return null;
}
