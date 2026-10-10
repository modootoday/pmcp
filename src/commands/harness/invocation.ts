import { readFileSync, statSync } from "node:fs";
import { ArgumentError, one, type CommandContext } from "../../cli/command.js";
import type { Operation } from "../../harness/contracts.js";
import { object } from "../../harness/validation.js";

const common = ["group-file", "generation"];
const options: Readonly<Record<string, readonly string[]>> = {
  "capabilities:inspect": [],
  "doctor:inspect": [],
  "group:create": ["input"],
  "group:list": [],
  "group:inspect": ["group-file"],
  "group:configure": [...common, "input"],
  "group:pause": common,
  "group:resume": common,
  "group:stop": common,
  "session:start": [...common, "input"],
  "session:list": ["group-file"],
  "session:inspect": ["group-file", "session"],
  "session:read": ["group-file", "session", "input"],
  "session:watch": ["group-file", "session", "input"],
  "session:stop": [...common, "session"],
  "control:acquire": [...common, "session", "controller", "mode"],
  "control:renew": [...common, "lease-file"],
  "control:release": [...common, "lease-file"],
  "input:write": [...common, "lease-file", "request-id", "text-file"],
  "input:submit": [...common, "lease-file", "request-id"],
  "input:interrupt": [...common, "lease-file"],
  "attach:open": [...common, "session", "mode", "lease-file"],
  "attach:inspect": ["group-file", "session"],
  "attach:detach": [...common, "session"],
  "delivery:list": ["group-file"],
  "delivery:inspect": ["group-file", "request-id"],
  "recovery:inspect": ["group-file", "include-starts"],
  "recovery:reconcile": common,
  "recovery:replace-main": [...common, "input"],
  "recovery:stop-orphan": [...common, "session"],
  "recovery:abort-start": [...common, "session"],
};

function file(path: string): string {
  const stat = statSync(path);
  if (!stat.isFile() || stat.size > 65_536)
    throw new ArgumentError("Input file exceeds 65536 bytes");
  return readFileSync(path, "utf8");
}

export function parseInvocation(context: CommandContext): Operation {
  const [family, action, ...extra] = context.args.positional;
  const key = `${family}:${action}`;
  const allowed = options[key];
  if (!family || !action || !allowed || extra.length > 0)
    throw new ArgumentError("Provide a supported family and operation");
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
