import type { CommandSpec } from "../../cli/command.js";
import { jsonOption } from "../options/inspection.js";

export const mcpSpec: CommandSpec = {
  name: "mcp",
  examples: [
    "pmcp mcp login remote --no-wait",
    "pmcp mcp status remote --json",
  ],
  subcommands: [
    {
      name: "login",
      describe: "Sign a shared remote MCP server in",
      usage:
        "pmcp mcp login <name> [--no-wait | --code <callback-or-code>] [--port <port>] [--client-id <id>] [--bearer-env <name>]",
      options: ["code", "no-wait", "port", "client-id", "bearer-env", "config"],
      examples: [
        "pmcp mcp login remote --no-wait",
        "pmcp mcp login remote --code 'http://127.0.0.1:8976/callback?code=...'",
      ],
    },
    {
      name: "logout",
      describe: "Clear its stored credentials",
      usage: "pmcp mcp logout <name>",
      options: ["config"],
      examples: ["pmcp mcp logout remote"],
    },
    {
      name: "status",
      describe: "Presence, UTC expiry and scopes; never tokens",
      usage: "pmcp mcp status <name> [--json]",
      options: ["config", "json"],
      examples: ["pmcp mcp status remote"],
    },
  ],
  describe: "Manage the project's shared remote MCP authentication",
  usage: "pmcp mcp <subcommand> <name> [options]",
  options: [
    jsonOption,
    {
      name: "config",
      describe: "A pmcp.toml to read instead of the nearest one.",
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
