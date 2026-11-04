import { readFileSync, statSync } from "node:fs";
import {
  ArgumentError,
  one,
  unknownSubcommand,
  type CommandContext,
} from "../../cli/command.js";
import type { Operation } from "../../harness/contracts.js";
import { object } from "../../harness/validation.js";
import { HARNESS_OPERATIONS } from "../specs/harness-operations.js";

function file(path: string): string {
  const stat = statSync(path);
  if (!stat.isFile() || stat.size > 65_536)
    throw new ArgumentError("Input file exceeds 65536 bytes");
  return readFileSync(path, "utf8");
}

export function parseInvocation(context: CommandContext): Operation {
  const [family, action, ...extra] = context.args.positional;
  const key = `${family}:${action}`;
  const allowed = HARNESS_OPERATIONS[key]?.options;
  const families = [
    "layout",
    "host",
    "mcp",
    ...new Set(
      Object.keys(HARNESS_OPERATIONS).map((name) => name.split(":")[0]!),
    ),
  ];
  if (!family || !families.includes(family))
    throw unknownSubcommand("harness", family, families);
  if (!allowed || !action) {
    const actions = Object.keys(HARNESS_OPERATIONS)
      .filter((name) => name.startsWith(`${family}:`))
      .map((name) => name.slice(family.length + 1));
    throw unknownSubcommand(`harness ${family}`, action, actions);
  }
  if (extra.length > 0)
    throw new ArgumentError(`unexpected ${extra.join(" ")}`);
  for (const option of [
    ...context.args.options.keys(),
    ...context.args.flags,
  ]) {
    if (!allowed.includes(option))
      throw new ArgumentError(
        `--${option} is not supported by ${family} ${action}`,
      );
  }
  for (const option of allowed) {
    if (
      option === "mode" ||
      option === "include-starts" ||
      (option === "input" && key === "session:read") ||
      (option === "lease-file" && family === "attach") ||
      (option === "generation" && family === "attach" && action === "open")
    )
      continue;
    if (!one(context.args, option))
      throw new ArgumentError(`Provide --${option}`);
  }
  const inputFile = one(context.args, "input");
  const textFile = one(context.args, "text-file");
  if (family === "attach" && one(context.args, "mode") === "write") {
    if (!one(context.args, "generation") || !one(context.args, "lease-file"))
      throw new ArgumentError(
        "Writable attachment requires a generation and lease file",
      );
  }
  return {
    family,
    action,
    groupFile: one(context.args, "group-file"),
    generation: one(context.args, "generation"),
    input: inputFile ? object(JSON.parse(file(inputFile))) : undefined,
    sessionId: one(context.args, "session"),
    leaseFile: one(context.args, "lease-file"),
    controller: one(context.args, "controller"),
    mode: one(context.args, "mode"),
    requestId: one(context.args, "request-id"),
    text: textFile ? file(textFile) : undefined,
    ...(context.args.flags.has("include-starts")
      ? { includeStarts: true }
      : {}),
  };
}
