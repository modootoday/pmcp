import {
  ArgumentError,
  many,
  one,
  type Command,
  type CommandContext,
} from "../cli/command.js";
import { ProjectError } from "../project/package-rules.js";
import { projectSpec } from "./specs/project.js";

// Load each project verb separately so MCP launches do not pay for projection dependencies.
async function route(
  context: CommandContext,
  verb: string | undefined,
  name: string | undefined,
): Promise<number> {
  if (verb === "exec-mcp") {
    if (
      name === undefined ||
      context.args.flags.has("check") ||
      context.args.flags.has("write") ||
      many(context.args, "source").length > 0 ||
      many(context.args, "name").length > 0
    ) {
      throw new ArgumentError("exec-mcp takes only a declared MCP alias");
    }
    const { runExecMcp } = await import("./project/exec-mcp.js");
    return await runExecMcp(context, name);
  }
  if (verb === "import-mcp") {
    if (name !== undefined || context.args.flags.has("check")) {
      throw new ArgumentError(
        "import-mcp takes --source, --name and --write; no positional name or --check",
      );
    }
    const { importMcp } = await import("./project/import-mcp.js");
    return importMcp(context);
  }
  if (
    many(context.args, "source").length > 0 ||
    one(context.args, "name") !== undefined ||
    context.args.flags.has("write")
  ) {
    throw new ArgumentError("--source, --name and --write require import-mcp");
  }
  const apply = await import("./project/apply.js");
  if (verb === undefined) return apply.projectOrCheck(context);
  if (context.args.flags.has("check")) {
    throw new ArgumentError("--check takes no subcommand");
  }
  if (name === undefined) {
    throw new ArgumentError(`${verb} needs a name`);
  }
  if (verb === "add") return apply.addAndProject(context, name);
  if (verb === "remove") return apply.removeAndProject(context, name);
  throw new ArgumentError(`unknown subcommand ${verb}`);
}

export const projectCommand: Command = {
  ...projectSpec,
  async run(context) {
    const [verb, name, ...extra] = context.args.positional;
    if (extra.length > 0) {
      throw new ArgumentError(`unexpected ${extra.join(" ")}`);
    }
    try {
      return await route(context, verb, name);
    } catch (error) {
      if (error instanceof ProjectError) {
        context.ui.error(error.message);
        return 1;
      }
      throw error;
    }
  },
};
