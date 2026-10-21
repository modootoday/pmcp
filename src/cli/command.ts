// Generate help from command metadata so documented flags cannot drift from accepted flags.

import type { Ui } from "./ui.js";

export interface OptionSpec {
  readonly name: string;
  readonly describe: string;

  readonly boolean?: boolean;

  readonly repeat?: boolean;
  readonly placeholder?: string;
}

export interface ParsedArgs {
  readonly positional: readonly string[];
  readonly options: ReadonlyMap<string, readonly string[]>;
  readonly flags: ReadonlySet<string>;
}

export interface CommandContext {
  readonly ui: Ui;
  readonly args: ParsedArgs;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly cwd: string;
}

// Keep help metadata separate so help and completion do not load command dependencies.
export interface CommandSpec {
  readonly name: string;
  readonly describe: string;
  readonly usage: string;
  readonly options?: readonly OptionSpec[];
}

// Keep published exit meanings stable for callers that branch on them.
export const EXIT = {
  ok: 0,
  failure: 1,
  usage: 2,
  missingOptional: 3,
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

// Reject unknown options so misspelled flags cannot silently select default behavior.
export function parseArgs(
  argv: readonly string[],
  specs: readonly OptionSpec[] = [],
): ParsedArgs {
  const byName = new Map(specs.map((spec) => [spec.name, spec]));
  const positional: string[] = [];
  const options = new Map<string, string[]>();
  const flags = new Set<string>();

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === "--") {
      positional.push(...argv.slice(i + 1));
      break;
    }
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const eq = arg.indexOf("=");
    const name = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
    const spec = byName.get(name);
    if (spec === undefined) {
      throw new ArgumentError(`unknown option --${name}`);
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

  return { positional, options, flags };
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
        `--${option.name}${option.placeholder ? ` ${option.placeholder}` : ""}`,
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
    ["--no-color", "never colour output; NO_COLOR is honoured too"],
    ["--version", "print the version"],
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
