import {
  ArgumentError,
  EXIT,
  parseArgs,
  printCommandHelp,
  printHelp,
  type Command,
  type CommandEntry,
  type CommandSpec,
} from "../cli/command.js";
import { envelope } from "../cli/envelope.js";
import { Ui } from "../cli/ui.js";
import { entryMode } from "../cli/entry.js";
import { invocation } from "../cli/invocation.js";
import { didYouMean } from "../cli/suggest.js";
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
const VERSION_WORDS = new Set(["--version", "-v", "-V", "version"]);

function colourChoice(global: readonly string[]): { color?: boolean } {
  if (global.includes("--no-color")) return { color: false };
  if (global.includes("--color")) return { color: true };
  return {};
}

export function dispatch(
  argv: readonly string[],
  options: DispatchOptions = {},
): number | Promise<number> {
  // Words after -- belong to the command a verb runs, never to pmcp.
  const cut = argv.indexOf("--");
  const head = cut < 0 ? argv : argv.slice(0, cut);
  const tail = cut < 0 ? [] : argv.slice(cut);
  const global = head.filter((arg) => GLOBAL.has(arg));
  const rest0 = [...head.filter((arg) => !GLOBAL.has(arg)), ...tail];
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
    if (rest[0] === undefined) {
      printHelp(ui.results, COMMANDS, PLANNED);
      return EXIT.ok;
    }
    const named = commandNamed(rest[0]);
    if (named === undefined) return unknownCommand(rest[0], { ui, env, cwd });
    printCommandHelp(ui.results, named);
    return EXIT.ok;
  }
  if (VERSION_WORDS.has(verb)) {
    if (rest.length > 0) {
      ui.error(`${verb} takes no arguments, got ${rest[0]}`);
      return EXIT.usage;
    }
    ui.data(`${VERSION}\n`);
    return EXIT.ok;
  }

  // Keep bare serving for MCP hosts that pass server options without a verb, but only
  // for options the server knows: a typo must not start a server that waits on stdin.
  if (verb.startsWith("-")) {
    const serve = required("serve");
    if (!leadsServe(verb, serve)) {
      const name = verb.split("=")[0]!;
      const known = ["--version", "--help", "--quiet", "--color", "--no-color"];
      ui.error(`unknown option ${name}${didYouMean(name, known, plain)}`);
      ui.line(`Run ${invocation(env)} --help for the commands and options.`);
      return EXIT.usage;
    }
    return run(serve, rest0, { ui, env, cwd });
  }

  const command = commandNamed(verb);
  if (command === undefined) return unknownCommand(verb, { ui, env, cwd });

  const own = rest.includes("--") ? rest.slice(0, rest.indexOf("--")) : rest;
  if (own.includes("--help") || own.includes("-h")) {
    printCommandHelp(ui.results, command);
    return EXIT.ok;
  }

  return run(command, rest, { ui, env, cwd });
}

const plain = (word: string): string => word;

function unknownCommand(verb: string, context: RunContext): number {
  if (PLANNED.includes(verb)) {
    context.ui.error(`"${verb}" is designed but not implemented yet`);
  } else {
    const names = COMMANDS.map((command) => command.name);
    context.ui.error(`unknown command "${verb}"${didYouMean(verb, names)}`);
  }
  context.ui.line(`Run ${invocation(context.env)} --help for the commands.`);
  return EXIT.usage;
}

function leadsServe(arg: string, serve: CommandEntry): boolean {
  if (!arg.startsWith("--")) return false;
  const eq = arg.indexOf("=");
  const name = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
  return (serve.options ?? []).some((option) => option.name === name);
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
  printHelp(context.ui.results, COMMANDS, PLANNED);
  return EXIT.ok;
}

async function run(
  entry: CommandEntry,
  argv: readonly string[],
  context: RunContext,
): Promise<number> {
  const command = await entry.load();
  const own = argv.includes("--") ? argv.slice(0, argv.indexOf("--")) : argv;
  const json = own.includes("--json") && command.protocol !== true;
  if (json) context.ui.capture();
  const code = await runCaught(command, argv, context);
  if (!json) return code;
  const { printed, errors } = context.ui.release();
  const words = schemaWords(command, positionalWords(own));
  context.ui.data(
    `${JSON.stringify(envelope(words, code, printed, errors))}\n`,
  );
  return code;
}

async function runCaught(
  command: Command,
  argv: readonly string[],
  context: RunContext,
): Promise<number> {
  try {
    return await command.run({
      ...context,
      args: parseArgs(argv, command.options),
    });
  } catch (error) {
    if (error instanceof ArgumentError) {
      context.ui.error(error.message);
      context.ui.line(
        `Run ${invocation(context.env)} ${command.name} --help for its usage.`,
      );
      return EXIT.usage;
    }
    context.ui.error(error instanceof Error ? error.message : "command failed");
    return EXIT.failure;
  }
}

// Leading words before any option: the subcommand path, if the command has one.
function positionalWords(argv: readonly string[]): string[] {
  const words: string[] = [];
  for (const arg of argv) {
    if (arg.startsWith("-")) break;
    words.push(arg);
  }
  return words;
}

// The schema is named by the command and the subcommand that ran, e.g. pmcp.hooks.list.v1.
export function schemaWords(
  command: CommandSpec,
  words: readonly string[],
): string[] {
  const names = (command.subcommands ?? []).map((sub) => sub.name);
  const two = words.slice(0, 2).join(" ");
  const one = words[0];
  if (names.includes(two)) return [command.name, ...two.split(" ")];
  if (one !== undefined && names.includes(one)) return [command.name, one];
  if (one === undefined && command.defaultSubcommand !== undefined)
    return [command.name, command.defaultSubcommand];
  return [command.name];
}
