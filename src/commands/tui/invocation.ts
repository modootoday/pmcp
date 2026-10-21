import { ArgumentError, one, type ParsedArgs } from "../../cli/command.js";

export { tuiOptions } from "./options.js";

const allowed: Readonly<Record<string, readonly string[]>> = {
  launch: ["config", "runtime", "yes", "new"],
  plan: ["config", "runtime"],
  recovery: ["config"],
  "start-worker": ["config", "runtime", "memory-mb"],
  doctor: [],
};

// The tmux view operations of releases up to 0.17.4; named in the usage error so an old
// script learns why, not just that the operation is unknown.
const REMOVED = new Set([
  "create",
  "inspect",
  "open",
  "main",
  "observe",
  "control",
  "release",
  "history",
  "mailbox",
  "resize",
  "stop",
  "detach",
  "disconnect",
  "close",
  "dismiss",
  "management",
  "worker-menu",
  "check",
]);

export interface TuiInvocation {
  action: "doctor" | "launch" | "plan" | "recovery" | "start-worker";
  startup?: {
    config?: string;
    runtime?: string;
    fresh?: boolean;
    confirmed?: boolean;
    memoryMb?: number;
  };
}

export function parseTui(args: ParsedArgs): TuiInvocation {
  const [action = "launch", ...extra] = args.positional;
  if (REMOVED.has(action))
    throw new ArgumentError(
      `tui ${action} was a tmux view operation and is removed; run pmcp tui, which opens pmcp-tui on the group's pmcp-pty host`,
    );
  const options = allowed[action];
  if (!options || extra.length)
    throw new ArgumentError("Provide one supported TUI operation");
  for (const key of [...args.options.keys(), ...args.flags])
    if (!options.includes(key))
      throw new ArgumentError(`--${key} is not supported by tui ${action}`);
  const required = (key: string): string => {
    const value = one(args, key);
    if (!value) throw new ArgumentError(`Provide --${key}`);
    return value;
  };
  const number = (key: string): number | undefined => {
    const value = one(args, key);
    if (value === undefined) return undefined;
    if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)))
      throw new ArgumentError(`--${key} requires an integer`);
    return Number(value);
  };
  if (action === "doctor") return { action };
  if (action === "start-worker")
    return {
      action,
      startup: {
        config: one(args, "config"),
        runtime: required("runtime"),
        memoryMb: number("memory-mb"),
      },
    };
  return {
    action: action as "launch" | "plan" | "recovery",
    startup: {
      config: one(args, "config"),
      runtime: one(args, "runtime"),
      fresh: args.flags.has("new"),
      confirmed: args.flags.has("yes"),
    },
  };
}
