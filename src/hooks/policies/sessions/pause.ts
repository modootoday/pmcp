import type { HookInput } from "../../contract.js";
import { mutates } from "../../shell/classify.js";
import type { Pause } from "../../../sessions/types.js";
import { realSteps } from "../_shared.js";
import {
  onlyKeys,
  pass,
  stringList,
  type Policy,
  type PolicyContext,
} from "../types.js";

const MUTATING =
  /\b(git\s+(commit|push|merge|rebase|reset|checkout|switch|cherry-pick|revert|am|stash|tag|clean|restore|rm|mv|worktree\s+(add|remove|move))|bun\s+(install|i|add|remove|rm|update|link)\b|(npm|pnpm|yarn)\s+(install|i|add|remove|publish|ci)\b|docker\s+(compose|build|push|run|rm|stop|restart)|wrangler\s+(deploy|publish|secret))\b/u;

interface PauseOptions {
  // A project's own scripts that change the checkout, run with node (pmcp.toml data).
  readonly scripts: readonly RegExp[];
}

function changes(input: HookInput, options: PauseOptions): boolean {
  const tool = input.tool;
  if (tool?.kind === "edit") return true;
  if (tool?.kind !== "shell") return false;
  if (!tool.steps) {
    const command = tool.command ?? "";
    return (
      MUTATING.test(command) || options.scripts.some((s) => s.test(command))
    );
  }
  return realSteps(tool.steps).some((step) =>
    mutates(step.argv, options.scripts),
  );
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
    onlyKeys(raw, ["refuses", "scripts"]);
    if (raw["refuses"] !== undefined && raw["refuses"] !== "mutating")
      throw new Error("refuses must be mutating");
    const scripts = (stringList(raw, "scripts") ?? []).map((source) => {
      try {
        return new RegExp(source, "u");
      } catch {
        throw new Error(`scripts: ${source} is not a regular expression`);
      }
    });
    return { scripts };
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
