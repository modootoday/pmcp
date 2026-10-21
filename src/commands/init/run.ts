import {
  existsSync,
  mkdtempSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { ArgumentError, one, type CommandContext } from "../../cli/command.js";
import { readConfig } from "../../config.js";
import { readGitConfig } from "../../git/config.js";
import { readSpec } from "../../project/spec.js";
import { preset } from "./preset.js";

export function run(context: CommandContext): number {
  if (context.args.positional.length)
    throw new ArgumentError("Use init [--preset solo|multi-session] [--force]");
  const kind = one(context.args, "preset") ?? "solo";
  if (kind !== "solo" && kind !== "multi-session")
    throw new ArgumentError("--preset must be solo or multi-session");
  const path = join(context.cwd, "pmcp.toml");
  if (existsSync(path) && !context.args.flags.has("force"))
    throw new ArgumentError("pmcp.toml exists; use --force to replace it");
  const result = preset(context.cwd, kind);
  const scratch = mkdtempSync(join(context.cwd, ".pmcp-init-"));
  try {
    const temporary = join(scratch, "pmcp.toml");
    writeFileSync(temporary, result.content, { flag: "wx" });
    const config = readConfig(temporary);
    readSpec({ ...config, dir: context.cwd });
    readGitConfig({ ...config, dir: context.cwd });
    if (context.args.flags.has("force")) renameSync(temporary, path);
    if (!context.args.flags.has("force"))
      writeFileSync(path, result.content, { flag: "wx" });
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  context.ui.success("created pmcp.toml (" + kind + ")");
  for (const reason of result.reasons) context.ui.line("  why " + reason);
  context.ui.line("  Next: pmcp project, then pmcp status");
  return 0;
}
