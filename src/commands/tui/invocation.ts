import {
  ArgumentError,
  one,
  type OptionSpec,
  type ParsedArgs,
} from "../../cli/command.js";
import type { Action, CreateInput, ViewInput } from "../../tui/contracts.js";

export const tuiOptions: readonly OptionSpec[] = [
  {
    name: "group-file",
    describe: "Existing owned harness group",
    placeholder: "<file>",
  },
  { name: "view", describe: "Private TUI view state", placeholder: "<file>" },
  {
    name: "columns",
    describe: "Terminal columns (40–1000)",
    placeholder: "<count>",
  },
  { name: "rows", describe: "Terminal rows (12–1000)", placeholder: "<count>" },
  { name: "index", describe: "Worker dock index", placeholder: "<count>" },
  {
    name: "confirm-session",
    describe: "Exact target ID for stop",
    placeholder: "<id>",
  },
  {
    name: "config",
    describe: "Optional mailbox pmcp.toml",
    placeholder: "<file>",
  },
  {
    name: "actor-file",
    describe: "Optional private mailbox observer credential",
    placeholder: "<file>",
  },
];

const allowed: Readonly<Record<string, readonly string[]>> = {
  doctor: [],
  create: ["group-file", "columns", "rows", "config", "actor-file"],
  inspect: ["view"],
  open: ["view"],
  main: ["view"],
  observe: ["view", "index"],
  control: ["view"],
  release: ["view"],
  history: ["view"],
  mailbox: ["view"],
  resize: ["view", "columns", "rows"],
  stop: ["view", "confirm-session"],
  detach: ["view"],
  disconnect: ["view"],
  close: ["view"],
  dismiss: ["view"],
  management: ["view"],
  check: ["view"],
};

export interface TuiInvocation {
  action: Action | "create" | "doctor";
  viewFile?: string;
  create?: CreateInput;
  input: ViewInput;
}

export function parseTui(args: ParsedArgs): TuiInvocation {
  const [action, ...extra] = args.positional;
  const options = action ? allowed[action] : undefined;
  if (!action || !options || extra.length)
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
  if (action === "doctor") return { action, input: {} };
  if (action === "create") {
    const config = one(args, "config");
    const actorFile = one(args, "actor-file");
    if (Boolean(config) !== Boolean(actorFile))
      throw new ArgumentError("Provide both --config and --actor-file");
    const groupFile = required("group-file");
    const columns = number("columns") ?? process.stdout.columns ?? 0;
    const rows = number("rows") ?? process.stdout.rows ?? 0;
    return {
      action,
      input: {},
      create: {
        groupFile,
        columns,
        rows,
        ...(config && actorFile ? { mailbox: { config, actorFile } } : {}),
      },
    };
  }
  if (action === "resize") {
    required("columns");
    required("rows");
  }
  if (action === "stop") required("confirm-session");
  return {
    action: action as Action,
    viewFile: required("view"),
    input: {
      columns: number("columns"),
      rows: number("rows"),
      index: number("index"),
      confirmSession: one(args, "confirm-session"),
    },
  };
}
