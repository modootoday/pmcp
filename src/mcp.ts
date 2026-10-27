// Compose MCP operations from transport-independent tools so hosts can reuse the same catalog behavior.

import { McpServer } from "@modelcontextprotocol/server";

import { registerSkillPrompts } from "./prompts.js";
import { registerSkillResources } from "./resources.js";
import {
  createSkillTools,
  type SkillServerOptions,
  type SkillTools,
} from "./server.js";
import {
  registerSkillsExtension,
  type SkillsExtensionOptions,
} from "./skills-extension.js";
import { registerBundleTool } from "./tools/bundle.js";
import { registerCallTool } from "./tools/call.js";
import { registerCatalogTool } from "./tools/catalog.js";
import { registerDescribeTool } from "./tools/describe.js";
import { registerFindTool } from "./tools/find.js";
import { registerReadTool } from "./tools/read.js";
import { registerMailboxTools } from "./tools/mailbox.js";
import type { MailboxService } from "./mailbox/service.js";

export const SERVER_NAME = "pmcp";

export const SERVER_VERSION = "0.21.0";

export const MAX_TOOL_INPUT_ELEMENTS = 10_000;

// Export registration separately so existing MCP hosts need not start another server process.
export function registerSkillTools(
  server: McpServer,
  tools: SkillTools,
): McpServer {
  registerCatalogTool(server, tools);
  registerFindTool(server, tools);
  registerDescribeTool(server, tools);
  registerReadTool(server, tools);
  registerCallTool(server, tools);
  registerBundleTool(server, tools);
  return server;
}

export interface SkillMcpOptions extends SkillServerOptions {
  readonly mailbox?: MailboxService;

  readonly prompts?: boolean;
  readonly skillsExtension?: SkillsExtensionOptions;
}

// Load the catalog lazily so connecting without requests does not pay for discovery.
export function createSkillServer(options: SkillMcpOptions): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { maxToolInputElements: MAX_TOOL_INPUT_ELEMENTS },
  );
  const tools = createSkillTools(options);
  registerSkillsExtension(server, tools.skills, options.skillsExtension);
  registerSkillResources(server, tools.skills);
  if (options.prompts) registerSkillPrompts(server, tools);
  if (options.mailbox) registerMailboxTools(server, options.mailbox);
  return registerSkillTools(server, tools);
}
