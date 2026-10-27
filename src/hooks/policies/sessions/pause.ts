import type { HookInput } from "../../contract.js";
import {
  DEFAULT_MUTATING_COMMANDS,
  DEFAULT_MUTATING_SCRIPT_NAMES,
  mutates,
  type MutatingRules,
} from "../../shell/classify.js";
import type { Pause } from "../../../sessions/types.js";
import { realSteps } from "../_shared.js";
import {
  onlyKeys,
  pass,
  stringList,
  type Policy,
  type PolicyContext,
} from "../types.js";

// Text fallback for unreadable shell syntax: git and package-manager verbs; commands and scripts
// come from the options.
const BUILT_IN =
  /\b(git\s+(commit|push|merge|rebase|reset|checkout|switch|cherry-pick|revert|am|stash|tag|clean|restore|rm|mv|worktree\s+(add|remove|move))|bun\s+(install|i|add|remove|rm|update|link)\b|(npm|pnpm|yarn)\s+(install|i|add|remove|publish|ci)\b)\b/u;

const escape = (word: string) => word.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

type PauseOptions = MutatingRules;

function changes(input: HookInput, options: PauseOptions): boolean {
  const tool = input.tool;
  if (tool?.kind === "edit") return true;
  if (tool?.kind !== "shell") return false;
  if (!tool.steps) {
    const command = tool.command ?? "";
    return (
      BUILT_IN.test(command) ||
      options.commands.some((prefix) =>
        new RegExp(`\\b${prefix.map(escape).join("\\s+")}\\b`, "u").test(
          command,
        ),
      ) ||
      options.scripts.some((s) => s.test(command))
    );
  }
  return realSteps(tool.steps).some((step) => mutates(step.argv, options));
}

function patterns(raw: Record<string, unknown>, key: string): RegExp[] | null {
  const list = stringList(raw, key);
  if (list === undefined) return null;
  return list.map((source) => {
    try {
      return new RegExp(source, "u");
    } catch {
      throw new Error(`${key}: ${source} is not a regular expression`);
    }
  });
}

function prefixes(raw: Record<string, unknown>): string[][] | null {
  const value = raw["commands"];
  if (value === undefined) return null;
  if (
    !Array.isArray(value) ||
    !value.every(
      (prefix) =>
        Array.isArray(prefix) &&
        prefix.length > 0 &&
        prefix.every((word) => typeof word === "string" && word !== ""),
    )
  )
    throw new Error("commands must be a list of argv prefixes");
  return value as string[][];
}

// Accept session ids and aliases because operators may identify their own pause by either.
function foreign(
  pause: Pause,
  input: HookInput,
  ctx: PolicyContext<PauseOptions>,
): boolean {
  const session = input.session.id;
  if (pause.by === session) return false;
  const alias = ctx.store.registry.get(session)?.alias;
  return !alias || pause.by !== alias;
}

export const pause: Policy<PauseOptions> = {
  id: "sessions.pause",
  events: ["session_start", "prompt", "before_tool"],
  tools: ["shell", "edit"],
  fail: "closed",
  defaultMode: "deny",
  options(raw) {
    onlyKeys(raw, ["refuses", "scripts", "commands", "script_names"]);
    if (raw["refuses"] !== undefined && raw["refuses"] !== "mutating")
      throw new Error("refuses must be mutating");
    return {
      scripts: patterns(raw, "scripts") ?? [],
      commands: prefixes(raw) ?? DEFAULT_MUTATING_COMMANDS,
      scriptNames:
        patterns(raw, "script_names") ??
        DEFAULT_MUTATING_SCRIPT_NAMES.map((source) => new RegExp(source, "u")),
    };
  },
  evaluate(input, ctx) {
    const current = ctx.store.pause.read();
    if (!current || !foreign(current, input, ctx)) return pass;
    if (input.event !== "before_tool") {
      return {
        context: [
          `The workspace is paused (${current.reason}, since ${current.since}). Edits and mutating commands are refused until the operator resumes it; reading and planning continue.`,
        ],
      };
    }
    if (!changes(input, ctx.options)) return pass;
    return {
      verdict: "deny",
      reason: `The workspace is paused (${current.reason}, since ${current.since}). Changes, deliveries, installs and deploys wait until the operator runs pmcp sessions resume; reading and planning continue.`,
    };
  },
};
