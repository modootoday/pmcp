import {
  ArgumentError,
  parseArgs,
  printCommandHelp,
  printHelp,
  type Command,
} from "../cli/command.js";
import { Ui } from "../cli/ui.js";
import { entryMode } from "../cli/entry.js";

import { indexCommand } from "./reindex.js";
import { modelsCommand } from "./models.js";
import { listCommand } from "./list.js";
import { serveCommand } from "./serve.js";
import { loginCommand, logoutCommand, whoamiCommand } from "./session.js";
import { availableCommand } from "./available.js";
import { previewCommand } from "./preview.js";
import { installCommand, syncCommand } from "./install.js";
import { doctorCommand, projectCommand } from "./project.js";
import { validateCommand } from "./validate.js";
import { mailboxCommand } from "./mailbox.js";
import { harnessCommand } from "./harness.js";
import { tuiCommand } from "./tui.js";
import { marketplaceCommand } from "./marketplace.js";

export const COMMANDS: readonly Command[] = [
  serveCommand,
  listCommand,
  indexCommand,
  modelsCommand,
  loginCommand,
  logoutCommand,
  whoamiCommand,
  availableCommand,
  previewCommand,
  installCommand,
  syncCommand,
  projectCommand,
  doctorCommand,
  validateCommand,
  mailboxCommand,
  harnessCommand,
  tuiCommand,
  marketplaceCommand,
];

/**
 * Verbs the design names and this build does not have.
 *
 * Listed rather than stubbed. A stub is a command that exists, appears in help
 * and does nothing, which is the shape of every dead surface this repository
 * has had to retire; a name here answers "designed, not built" and cannot be
 * mistaken for working. They serve the catalog the server reads from: what is
 * available for the dependencies this project already has, and how it arrives.
 */
export const PLANNED: readonly string[] = [];

export interface DispatchOptions {
  readonly ui?: Ui;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly cwd?: string;
  readonly terminal?: { readonly stdin: boolean; readonly stdout: boolean };
}

/**
 * Options every command answers to, taken out before a command parses its own.
 * A flag that means one thing under one verb and another under the next is the
 * inconsistency the guidelines name first, so these are removed centrally and
 * no command may redeclare them.
 */
const GLOBAL = new Set(["-q", "--quiet", "--no-color", "--color"]);

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
      ...(global.includes("--no-color")
        ? { color: false }
        : global.includes("--color")
          ? { color: true }
          : {}),
    });
  const [verb, ...rest] = rest0;

  if (verb === undefined) {
    return defaultEntry(options, { ui, env, cwd });
  }
  if (verb === "--help" || verb === "-h" || verb === "help") {
    const named = COMMANDS.find((command) => command.name === rest[0]);
    if (named) printCommandHelp(ui, named);
    else printHelp(ui, COMMANDS, PLANNED);
    return 0;
  }
  if (verb === "--version") {
    ui.data(`${VERSION}\n`);
    return 0;
  }

  // A leading option with no verb is still a bare serve: hosts pass --root and
  // --scope without a command, and that has to keep working.
  if (verb.startsWith("-")) {
    return run(serveCommand, rest0, { ui, env, cwd });
  }

  const command = COMMANDS.find((candidate) => candidate.name === verb);
  if (command === undefined) {
    if (PLANNED.includes(verb))
      ui.error(`"${verb}" is designed but not implemented yet`);
    else ui.error(`unknown command "${verb}"`);
    printHelp(ui, COMMANDS, PLANNED);
    return 2;
  }

  if (rest.includes("--help") || rest.includes("-h")) {
    printCommandHelp(ui, command);
    return 0;
  }

  return run(command, rest, { ui, env, cwd });
}

export const VERSION = "0.15.0";

async function defaultEntry(
  options: DispatchOptions,
  context: {
    ui: Ui;
    env: Readonly<Record<string, string | undefined>>;
    cwd: string;
  },
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
  if (mode === "server") return run(serveCommand, [], context);
  if (mode === "terminal") {
    const { terminalSupport } = await import("../tui/startup/host.js");
    const support = terminalSupport();
    if (support.supported) return run(tuiCommand, [], context);
    context.ui.info(`Terminal workspace unavailable: ${support.reason}`);
    context.ui.line(
      "Run pmcp tui doctor for prerequisites, or pmcp serve for MCP.",
    );
  }
  printHelp(context.ui, COMMANDS, PLANNED);
  return 0;
}

async function run(
  command: Command,
  argv: readonly string[],
  context: {
    ui: Ui;
    env: Readonly<Record<string, string | undefined>>;
    cwd: string;
  },
): Promise<number> {
  try {
    return await command.run({
      ...context,
      args: parseArgs(argv, command.options),
    });
  } catch (error) {
    if (error instanceof ArgumentError) {
      context.ui.error(error.message);
      printCommandHelp(context.ui, command);
      return 2;
    }
    context.ui.error(error instanceof Error ? error.message : "command failed");
    return 1;
  }
}
