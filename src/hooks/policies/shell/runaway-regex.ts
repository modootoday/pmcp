import type { ShellStep } from "../../contract.js";
import { gitCall } from "../../shell/classify.js";
import { program, realSteps, shellCall } from "../_shared.js";
import { onlyKeys, pass, type Policy } from "../types.js";
import { patternCost, type CostLimits, type Flavor } from "./regex-cost.js";

interface RunawayOptions extends CostLimits {
  // `timeout <n> grep …` is bounded already and passes.
  readonly allowTimeout: boolean;
}

const GREPS: Readonly<Record<string, Flavor | "fixed">> = {
  grep: "basic",
  zgrep: "basic",
  egrep: "extended",
  fgrep: "fixed",
};
// Short and long options that take a value, so it is not read as the pattern or a flag cluster.
const VALUE_SHORT = new Set(["e", "f", "m", "A", "B", "C", "d", "D", "O"]);
const VALUE_LONG = new Set([
  "regexp",
  "file",
  "max-count",
  "after-context",
  "before-context",
  "context",
  "include",
  "exclude",
  "exclude-dir",
  "exclude-from",
  "binary-files",
  "devices",
  "directories",
  "label",
  "max-depth",
  "threads",
]);
const FLAVOR_SHORT: Readonly<Record<string, Flavor | "fixed">> = {
  E: "extended",
  P: "perl",
  F: "fixed",
  G: "basic",
};
const FLAVOR_LONG: Readonly<Record<string, Flavor | "fixed">> = {
  "extended-regexp": "extended",
  "perl-regexp": "perl",
  "fixed-strings": "fixed",
  "basic-regexp": "basic",
};

interface GrepCall {
  readonly patterns: readonly string[];
  readonly flavor: Flavor | "fixed";
  readonly onlyMatching: boolean;
}

// The patterns, syntax and -o of one grep (or git grep) argument list after the program name.
export function readGrep(
  args: readonly string[],
  start: Flavor | "fixed",
): GrepCall {
  const patterns: string[] = [];
  let flavor = start;
  let onlyMatching = false;
  let operand: string | undefined;
  let fromFile = false;
  for (let at = 0; at < args.length; at += 1) {
    const arg = args[at]!;
    if (arg === "--") {
      operand ??= args[at + 1];
      break;
    }
    if (arg.startsWith("--")) {
      const [name = "", inline] = arg.slice(2).split(/=(.*)/su);
      if (FLAVOR_LONG[name]) flavor = FLAVOR_LONG[name]!;
      if (name === "only-matching") onlyMatching = true;
      const value =
        VALUE_LONG.has(name) && inline === undefined ? args[(at += 1)] : inline;
      if (name === "regexp" && value !== undefined) patterns.push(value);
      if (name === "file") fromFile = true;
      continue;
    }
    if (arg.startsWith("-") && arg.length > 1) {
      for (let i = 1; i < arg.length; i += 1) {
        const flag = arg[i]!;
        if (FLAVOR_SHORT[flag]) flavor = FLAVOR_SHORT[flag]!;
        if (flag === "o") onlyMatching = true;
        if (!VALUE_SHORT.has(flag)) continue;
        const value = i + 1 < arg.length ? arg.slice(i + 1) : args[(at += 1)];
        if (flag === "e" && value !== undefined) patterns.push(value);
        if (flag === "f") fromFile = true;
        break;
      }
      continue;
    }
    operand ??= arg;
  }
  if (patterns.length === 0 && !fromFile && operand !== undefined)
    patterns.push(operand);
  return { patterns, flavor, onlyMatching };
}

function grepOf(argv: readonly string[]): GrepCall | null {
  const name = program(argv[0]);
  if (GREPS[name]) return readGrep(argv.slice(1), GREPS[name]!);
  if (name !== "git") return null;
  const call = gitCall(argv);
  return call.sub === "grep"
    ? readGrep(argv.slice(call.at + 1), "basic")
    : null;
}

// A `timeout` wrapper before the program bounds the run.
function timed(step: ShellStep): boolean {
  const at = step.raw.indexOf(step.argv[0]!);
  return step.raw
    .slice(0, at < 0 ? 0 : at)
    .some((word) => program(word) === "timeout");
}

function costOf(step: ShellStep, options: RunawayOptions): string | null {
  const grep = grepOf(step.argv);
  if (!grep || grep.flavor === "fixed") return null;
  if (options.allowTimeout && timed(step)) return null;
  for (const pattern of grep.patterns) {
    const why = patternCost(pattern, grep.flavor, grep.onlyMatching, options);
    if (why) return why;
  }
  return null;
}

const reason = (why: string, threshold: number) =>
  `This grep can keep a CPU core busy for minutes: ${why}. Find the line with grep -n and no -o or large count, then print a window around it with sed -n 'N,+K p' FILE; or use rg, which matches in linear time; or bring the count to ${threshold} or below; or bound the run with timeout 20 grep ….`;

function integer(
  raw: Readonly<Record<string, unknown>>,
  key: string,
  fallback: number,
): number {
  const value = raw[key] ?? fallback;
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > 32767
  )
    throw new Error(`${key} must be an integer from 1 to 32767`);
  return value;
}

function bool(
  raw: Readonly<Record<string, unknown>>,
  key: string,
  fallback: boolean,
): boolean {
  const value = raw[key] ?? fallback;
  if (typeof value !== "boolean")
    throw new Error(`${key} must be true or false`);
  return value;
}

export const runawayRegex: Policy<RunawayOptions> = {
  id: "shell.runaway_regex",
  events: ["before_tool"],
  tools: ["shell"],
  fail: "closed",
  defaultMode: "deny",
  options(raw) {
    onlyKeys(raw, ["threshold", "only_matching_wildcards", "allow_timeout"]);
    return {
      threshold: integer(raw, "threshold", 255),
      onlyMatchingWildcards: bool(raw, "only_matching_wildcards", false),
      allowTimeout: bool(raw, "allow_timeout", true),
    };
  },
  // Unreadable shell syntax passes: a wrong refusal here costs more than a slow grep.
  evaluate(input, ctx) {
    const call = shellCall(input);
    if (!call?.steps) return pass;
    for (const step of realSteps(call.steps)) {
      const why = costOf(step, ctx.options);
      if (why)
        return { verdict: "deny", reason: reason(why, ctx.options.threshold) };
    }
    return pass;
  },
};
