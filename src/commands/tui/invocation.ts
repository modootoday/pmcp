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
    name: "memory-mb",
    describe: "Worker memory reservation",
    placeholder: "<count>",
  },
  {
    name: "confirm-session",
    describe: "Exact target ID for stop",
    placeholder: "<id>",
  },
  {
    name: "config",
    describe: "Project pmcp.toml (or mailbox config for create)",
    placeholder: "<file>",
  },
  {
    name: "runtime",
    describe: "Native runtime ID for main launch or worker start",
    placeholder: "<runtime>",
  },
  {
    name: "yes",
    describe: "Confirm the first native runtime start",
    boolean: true,
  },
  {
    name: "new",
    describe: "Create a workspace after the previous group is stopped",
    boolean: true,
  },
  {
    name: "actor-file",
    describe: "Optional private mailbox observer credential",
    placeholder: "<file>",
  },
];

const allowed: Readonly<Record<string, readonly string[]>> = {
  launch: ["config", "runtime", "yes", "new"],
  plan: ["config", "runtime"],
  recovery: ["config"],
  "start-worker": ["config", "view", "runtime", "memory-mb"],
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
  "worker-menu": ["view"],
  check: ["view"],
};

export interface TuiInvocation {
  action:
    | Action
    | "create"
    | "doctor"
    | "launch"
    | "plan"
    | "recovery"
    | "start-worker";
  viewFile?: string;
  create?: CreateInput;
  input: ViewInput;
  startup?: {
    config?: string;
    runtime?: string;
    fresh?: boolean;
    confirmed?: boolean;
    memoryMb?: number;
  };
}

export function parseTui(args: ParsedArgs): TuiInvocation {
  let [action, ...extra] = args.positional;
  if (action === undefined) action = one(args, "view") ? "open" : "launch";
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
  if (action === "start-worker") {
    const config = one(args, "config");
    const viewFile = one(args, "view");
    if (config && viewFile)
      throw new ArgumentError("Choose --config or --view for worker start");
    return {
      action,
      viewFile,
      input: {},
      startup: {
        config,
        runtime: required("runtime"),
        memoryMb: number("memory-mb"),
      },
    };
  }
  if (action === "launch" || action === "plan" || action === "recovery")
    return {
      action,
      input: {},
      startup: {
        config: one(args, "config"),
        runtime: one(args, "runtime"),
        fresh: args.flags.has("new"),
        confirmed: args.flags.has("yes"),
      },
    };
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
