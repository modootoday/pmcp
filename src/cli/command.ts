// Generate help from command metadata so documented flags cannot drift from accepted flags.

import { didYouMean } from "./suggest.js";
import type { Ui } from "./ui.js";

export interface OptionSpec {
  readonly name: string;
  readonly describe: string;

  readonly boolean?: boolean;

  readonly repeat?: boolean;
  readonly placeholder?: string;
  // One letter that also selects a boolean option, such as y for --yes.
  readonly short?: string;
}

export interface ParsedArgs {
  readonly positional: readonly string[];
  readonly options: ReadonlyMap<string, readonly string[]>;
  readonly flags: ReadonlySet<string>;
  // The words after a bare --, kept apart so a command line to run is never read as options.
  readonly passthrough?: readonly string[];
}

export interface CommandContext {
  readonly ui: Ui;
  readonly args: ParsedArgs;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly cwd: string;
}

// Keep help metadata separate so help and completion do not load command dependencies.
export interface SubcommandSpec {
  // One word, or two for a nested verb such as "worktree create".
  readonly name: string;
  readonly describe: string;
  readonly usage?: string;
  // Names of the command's options that apply; absent means all of them.
  readonly options?: readonly string[];
  readonly examples?: readonly string[];
}

export interface CommandSpec {
  readonly name: string;
  readonly describe: string;
  readonly usage: string;
  readonly options?: readonly OptionSpec[];
  readonly subcommands?: readonly SubcommandSpec[];
  // The subcommand that runs when none is named, which also names its JSON schema.
  readonly defaultSubcommand?: string;
  readonly examples?: readonly string[];
  // Prints its own JSON receipts as a machine protocol, so --json adds no envelope.
  readonly protocol?: boolean;
}

// Keep published exit meanings stable for callers that branch on them.
export const EXIT = {
  ok: 0,
  failure: 1,
  usage: 2,
  missingOptional: 3,
  // A check ran and found differences: drift, stale outputs, a failed fixture, a budget over.
  differences: 4,
  // Not run because the host stayed busy; nothing changed, so a retry later is safe (EX_TEMPFAIL).
  busy: 75,
} as const;

export interface Command extends CommandSpec {
  run(context: CommandContext): number | Promise<number>;
}

export interface CommandEntry extends CommandSpec {
  load(): Promise<Command>;
}

export class ArgumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArgumentError";
  }
}

// One wording for a missing project configuration, whichever command needed it.
export const NO_CONFIG =
  "no pmcp.toml at or above this directory; run pmcp init to create one, or pass --config <file>";

export function noConfig(): ArgumentError {
  return new ArgumentError(NO_CONFIG);
}

// One wording for a missing or unknown subcommand, naming every valid one.
export function unknownSubcommand(
  command: string,
  word: string | undefined,
  verbs: readonly string[],
): ArgumentError {
  const list = verbs.join(", ");
  if (word === undefined) {
    return new ArgumentError(`${command} needs a subcommand: ${list}`);
  }
  return new ArgumentError(
    `unknown ${command} subcommand "${word}"${didYouMean(word, verbs)}; choose one of: ${list}`,
  );
}

const SHORT_FLAG = /^-[A-Za-z]/u;

// Reject unknown options so misspelled flags cannot silently select default behavior.
export function parseArgs(
  argv: readonly string[],
  specs: readonly OptionSpec[] = [],
): ParsedArgs {
  const byName = new Map(specs.map((spec) => [spec.name, spec]));
  const positional: string[] = [];
  const options = new Map<string, string[]>();
  const flags = new Set<string>();
  let passthrough: string[] | undefined;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === "--") {
      passthrough = argv.slice(i + 1);
      positional.push(...passthrough);
      break;
    }
    const short = specs.find(
      (spec) => spec.short !== undefined && arg === `-${spec.short}`,
    );
    if (short !== undefined) {
      flags.add(short.name);
      continue;
    }
    // A short flag nobody declared would otherwise become a positional and be ignored.
    if (SHORT_FLAG.test(arg)) {
      throw new ArgumentError(`unknown option ${arg}`);
    }
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const eq = arg.indexOf("=");
    const name = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
    const spec = byName.get(name);
    if (spec === undefined) {
      const names = specs.map((option) => `--${option.name}`);
      const hint = didYouMean(`--${name}`, names, (option) => option);
      throw new ArgumentError(`unknown option --${name}${hint}`);
    }
    if (spec.boolean === true) {
      if (eq !== -1) {
        throw new ArgumentError(`--${name} does not take a value`);
      }
      flags.add(name);
      continue;
    }
    const value = eq === -1 ? argv[++i] : arg.slice(eq + 1);
    if (value === undefined || value === "" || value.startsWith("--")) {
      throw new ArgumentError(`--${name} needs a value`);
    }
    const existing = options.get(name);
    if (existing !== undefined && spec.repeat !== true) {
      throw new ArgumentError(`--${name} was given more than once`);
    }
    options.set(name, [...(existing ?? []), value]);
  }

  return passthrough === undefined
    ? { positional, options, flags }
    : { positional, options, flags, passthrough };
}

export function one(args: ParsedArgs, name: string): string | undefined {
  return args.options.get(name)?.[0];
}

export function many(args: ParsedArgs, name: string): readonly string[] {
  return args.options.get(name) ?? [];
}

export function printCommandHelp(ui: Ui, command: CommandSpec): void {
  ui.heading(`pmcp ${command.name}`);
  ui.line(`  ${command.describe}`);
  ui.line();
  ui.line(`  ${ui.paint(command.usage, "dim")}`);
  if (command.options && command.options.length > 0) {
    ui.line();
    ui.table(
      command.options.map((option) => [
        `${option.short ? `-${option.short}, ` : ""}--${option.name}${option.placeholder ? ` ${option.placeholder}` : ""}`,
        option.describe,
      ]),
    );
  }
  ui.line();
}

export function printHelp(
  ui: Ui,
  commands: readonly CommandSpec[],
  notImplemented: readonly string[],
): void {
  ui.heading("pmcp — the skills your installed packages ship");
  ui.line();
  ui.table(commands.map((command) => [command.name, command.describe]));
  ui.line();
  ui.line(
    "  With no command, pmcp opens a terminal workspace on a supported TTY.",
  );
  ui.line(
    "  Piped launches retain MCP stdio. Use pmcp serve explicitly for MCP.",
  );
  ui.line();
  ui.table([
    ["-q, --quiet", "only errors"],
    ["--color", "always colour output; FORCE_COLOR=1 does the same"],
    ["--no-color", "never colour output; NO_COLOR and FORCE_COLOR=0 too"],
    ["-v, --version", "print the version (also -V and pmcp version)"],
    ["-h, --help", "this, or help for one command"],
  ]);
  ui.line();
  // Omit empty headings so help does not suggest that content is missing.
  if (notImplemented.length > 0) {
    ui.line(
      `  ${ui.paint(`not implemented yet: ${notImplemented.join(", ")}`, "dim")}`,
    );
    ui.line();
  }
}
