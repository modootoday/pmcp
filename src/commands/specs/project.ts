import type { CommandSpec } from "../../cli/command.js";
import { TOOLS } from "../../project/tools.js";
import { CATALOG_OPTIONS } from "../options/catalog.js";
import { nearestConfigOption } from "../options/inspection.js";

export const projectSpec: CommandSpec = {
  name: "project",
  examples: ["pmcp project", "pmcp project --check --smoke"],
  subcommands: [
    {
      name: "add",
      describe: "Add a skill or agent under .agents/ and project",
      usage: "pmcp project add <skill|agent>",
      options: [],
      examples: ["pmcp project add review-checklist"],
    },
    {
      name: "remove",
      describe: "Remove an asset and project",
      usage: "pmcp project remove <name>",
      options: [],
      examples: ["pmcp project remove review-checklist"],
    },
    {
      name: "import-mcp",
      describe: "Import MCP servers from a native config; --write applies",
      usage:
        "pmcp project import-mcp --source <tool>:<file> [--name <alias>] [--write]",
      options: ["source", "name", "write", "config"],
      examples: [
        "pmcp project import-mcp --source codex:~/.codex/config.toml",
        "pmcp project import-mcp --source claude:.mcp.json --name github --write",
      ],
    },
    {
      name: "exec-mcp",
      describe:
        "Start a declared MCP server; projected native entries run this",
      usage: "pmcp project exec-mcp <alias>",
      options: ["config"],
      examples: ["pmcp project exec-mcp remote"],
    },
  ],
  describe: "Write each agent tool's native files from .agents/ and pmcp.toml",
  usage:
    "pmcp project [--check [--smoke]] | pmcp project <subcommand> [options]",
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
        "Write nothing; exit 4 when an output drifted, went stale or is undeclared.",
      boolean: true,
    },
    {
      name: "smoke",
      describe:
        "With --check, also run the [hooks.test] fixtures through the projected hooks.",
      boolean: true,
    },
  ],
};

export const doctorSpec: CommandSpec = {
  name: "doctor",
  examples: ["pmcp doctor", "pmcp doctor --tool claude --json"],
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
    {
      name: "json",
      describe: "Print the result as one JSON envelope on stdout.",
      boolean: true,
    },
    {
      name: "memory",
      describe:
        "Report native memory configuration metadata only; do not read memory bodies or check MCP connections.",
      boolean: true,
    },
  ],
};
