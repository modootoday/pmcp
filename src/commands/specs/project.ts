import type { CommandSpec } from "../../cli/command.js";
import { TOOLS } from "../../project/tools.js";
import { CATALOG_OPTIONS } from "../options/catalog.js";
import { nearestConfigOption } from "../options/inspection.js";

export const projectSpec: CommandSpec = {
  name: "project",
  describe: "Write each agent tool's native files from .agents/ and pmcp.toml",
  usage:
    "pmcp project [--check] | pmcp project add <skill|agent> | pmcp project remove <name> | pmcp project import-mcp --source <tool>:<file> [--name <alias>] [--write]",
  options: [
    ...CATALOG_OPTIONS,
    {
      name: "source",
      describe:
        "Explicit native MCP source as <tool>:<file>. Repeatable; import-mcp only.",
      repeat: true,
      placeholder: "<tool>:<file>",
    },
    {
      name: "name",
      describe: "Import only this MCP alias. Repeatable; import-mcp only.",
      repeat: true,
      placeholder: "<alias>",
    },
    {
      name: "write",
      describe:
        "Back up and import the reviewed MCP declarations; import-mcp only.",
      boolean: true,
    },
    {
      name: "check",
      describe:
        "Write nothing; exit 2 when an output drifted, went stale or is undeclared.",
      boolean: true,
    },
  ],
};

export const doctorSpec: CommandSpec = {
  name: "doctor",
  describe:
    "Ask each agent tool, through its own listing commands, whether it loads this project's assets",
  usage: "pmcp doctor [--tool <name>] [--json] [--memory]",
  options: [
    nearestConfigOption,
    {
      name: "tool",
      describe: `Check only this tool (${TOOLS.join(", ")}). Repeatable.`,
      repeat: true,
      placeholder: "<name>",
    },
    { name: "json", describe: "Emit JSON rather than a table.", boolean: true },
    {
      name: "memory",
      describe:
        "Report native memory configuration metadata only; do not read memory bodies or check MCP connections.",
      boolean: true,
    },
  ],
};
