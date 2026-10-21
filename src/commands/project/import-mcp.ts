import { ArgumentError, many, type CommandContext } from "../../cli/command.js";
import { planMcpImport, writeMcpImport } from "../../project/mcp-import.js";
import { configFrom } from "../config-from.js";

export function importMcp(context: CommandContext): number {
  const config = configFrom(context);
  if (config === null) {
    throw new ArgumentError("MCP import needs an existing pmcp.toml");
  }
  const sources = many(context.args, "source");
  if (sources.length === 0) {
    throw new ArgumentError("import-mcp needs --source <tool>:<file>");
  }
  const plan = planMcpImport(config.path, sources, many(context.args, "name"));
  context.ui.table(
    plan.entries.map((entry) => [
      `${entry.status}  ${entry.alias}`,
      entry.detail ?? entry.source,
    ]),
  );
  if (
    plan.entries.some(
      (entry) => entry.status === "blocked" || entry.status === "conflict",
    )
  ) {
    return 1;
  }
  if (!context.args.flags.has("write")) {
    context.ui.info(
      "preview",
      "No files written. Use --write to import, then pmcp project to project.",
    );
    return 0;
  }
  if (Object.keys(plan.additions).length === 0) {
    context.ui.success("all selected servers already match");
    return 0;
  }
  const backup = writeMcpImport(plan);
  context.ui.info("backup", backup);
  context.ui.success(
    `imported ${Object.keys(plan.additions).length} MCP servers`,
    "pmcp project applies them",
  );
  return 0;
}
