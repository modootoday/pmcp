import { ArgumentError, one, type CommandContext } from "../cli/command.js";
import { findConfig, readConfig } from "../config.js";
import {
  operatorCheck,
  readOperatorSettings,
  requireOperator,
  type OperatorProbe,
  type OperatorSettings,
} from "./operator.js";

export function operatorSettingsFor(context: CommandContext): OperatorSettings {
  const path = one(context.args, "config") ?? findConfig(context.cwd);
  if (!path) return { via: "tty" };
  try {
    const config = readConfig(path);
    return readOperatorSettings(config.raw["sessions"], config.dir);
  } catch (error) {
    throw new ArgumentError(
      error instanceof Error ? error.message : String(error),
    );
  }
}

function probe(context: CommandContext): OperatorProbe {
  return { env: context.env, tty: process.stdin.isTTY === true };
}

export function isOperator(context: CommandContext): boolean {
  return operatorCheck(operatorSettingsFor(context), probe(context)).ok;
}

export function requireOperatorFor(context: CommandContext, verb: string) {
  requireOperator(verb, operatorSettingsFor(context), probe(context));
}
