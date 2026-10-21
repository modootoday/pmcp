import {
  ArgumentError,
  EXIT,
  parseArgs,
  printCommandHelp,
  printHelp,
  type CommandEntry,
} from "../cli/command.js";
import { Ui } from "../cli/ui.js";
import { entryMode } from "../cli/entry.js";
import { COMMANDS, PLANNED, commandNamed } from "./registry.js";
import { VERSION } from "./version.js";

export interface DispatchOptions {
  readonly ui?: Ui;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly cwd?: string;
  readonly terminal?: { readonly stdin: boolean; readonly stdout: boolean };
}

interface RunContext {
  ui: Ui;
  env: Readonly<Record<string, string | undefined>>;
  cwd: string;
}

// Reserve shared options so commands cannot assign conflicting meanings to the same flag.
const GLOBAL = new Set(["-q", "--quiet", "--no-color", "--color"]);

function colourChoice(global: readonly string[]): { color?: boolean } {
  if (global.includes("--no-color")) return { color: false };
  if (global.includes("--color")) return { color: true };
  return {};
}

export function dispatch(
  argv: readonly string[],
  options: DispatchOptions = {},
): number | Promise<number> {
  const global = argv.filter((arg) => GLOBAL.has(arg));
  const rest0 = argv.filter((arg) => !GLOBAL.has(arg));
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const ui =
    options.ui ??
    new Ui({
      env,
      quiet: global.includes("-q") || global.includes("--quiet"),
      ...colourChoice(global),
    });
  const [verb, ...rest] = rest0;

  if (verb === undefined) {
    return defaultEntry(options, { ui, env, cwd });
  }
  if (verb === "--help" || verb === "-h" || verb === "help") {
    const named = commandNamed(rest[0]);
    if (named) printCommandHelp(ui, named);
    if (!named) printHelp(ui, COMMANDS, PLANNED);
    return EXIT.ok;
  }
  if (verb === "--version") {
    ui.data(`${VERSION}\n`);
    return EXIT.ok;
  }

  // Keep bare serving compatible with MCP hosts that pass options without a verb.
  if (verb.startsWith("-")) {
    return run(required("serve"), rest0, { ui, env, cwd });
  }

  const command = commandNamed(verb);
  if (command === undefined) {
    if (PLANNED.includes(verb))
      ui.error(`"${verb}" is designed but not implemented yet`);
    if (!PLANNED.includes(verb)) ui.error(`unknown command "${verb}"`);
    printHelp(ui, COMMANDS, PLANNED);
    return EXIT.usage;
  }

  if (rest.includes("--help") || rest.includes("-h")) {
    printCommandHelp(ui, command);
    return EXIT.ok;
  }

  return run(command, rest, { ui, env, cwd });
}

function required(name: string): CommandEntry {
  const entry = commandNamed(name);
  if (entry === undefined) throw new Error(`${name} is not registered`);
  return entry;
}

async function defaultEntry(
  options: DispatchOptions,
  context: RunContext,
): Promise<number> {
  const terminal = options.terminal ?? {
    stdin: process.stdin.isTTY === true,
    stdout: process.stdout.isTTY === true,
  };
  const mode = entryMode({
    ...terminal,
    term: context.env.TERM,
    ci: context.env.CI,
  });
  if (mode === "server") return run(required("serve"), [], context);
  if (mode === "terminal") {
    const { terminalSupport } = await import("../tui/startup/host.js");
    const support = terminalSupport();
    if (support.supported) return run(required("tui"), [], context);
    context.ui.info(`Terminal workspace unavailable: ${support.reason}`);
    context.ui.line(
      "Run pmcp tui doctor for prerequisites, or pmcp serve for MCP.",
    );
  }
  printHelp(context.ui, COMMANDS, PLANNED);
  return EXIT.ok;
}

async function run(
  entry: CommandEntry,
  argv: readonly string[],
  context: RunContext,
): Promise<number> {
  const command = await entry.load();
  try {
    return await command.run({
      ...context,
      args: parseArgs(argv, command.options),
    });
  } catch (error) {
    if (error instanceof ArgumentError) {
      context.ui.error(error.message);
      printCommandHelp(context.ui, command);
      return EXIT.usage;
    }
    context.ui.error(error instanceof Error ? error.message : "command failed");
    return EXIT.failure;
  }
}
