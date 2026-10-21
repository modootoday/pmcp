import type { CommandSpec } from "../../cli/command.js";
import { jsonOption } from "../options/inspection.js";

export const mcpSpec: CommandSpec = {
  name: "mcp",
  describe: "Manage the project's shared remote MCP authentication",
  usage: "pmcp mcp <login|logout|status> <name> [--config <file>]",
  options: [
    jsonOption,
    {
      name: "config",
      describe: "Read this project configuration.",
      placeholder: "<file>",
    },
    {
      name: "code",
      describe:
        "Complete a pending login with a callback URL or authorization code.",
      placeholder: "<callback-or-code>",
    },
    {
      name: "no-wait",
      describe:
        "Print the authorization URL and save a pending login for later completion.",
      boolean: true,
    },
    {
      name: "port",
      describe: "Loopback callback port; zero chooses an available port.",
      placeholder: "<port>",
    },
    {
      name: "client-id",
      describe: "Use a pre-registered OAuth client identifier.",
      placeholder: "<id>",
    },
    {
      name: "bearer-env",
      describe:
        "Store a bearer session from this environment variable without printing it.",
      placeholder: "<name>",
    },
  ],
};
