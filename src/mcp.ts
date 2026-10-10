/**
 * The catalog, spoken over MCP: the skill_* tools, skill:// resources, the
 * Skills extension and, when asked for, one prompt per skill.
 *
 * Thin on purpose: every decision is in createSkillTools and the modules under
 * tools/ and files/; this file only composes them on one server.
 */

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

/** Reported to the host on connect. */
export const SERVER_NAME = "pmcp";

export const SERVER_VERSION = "0.13.1";

/**
 * Registers the skill_* tools on a server.
 *
 * Exported separately from the stdio entry so a consumer already running an MCP
 * server can add these to it rather than starting a second process.
 */
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
  /** One prompt per skill, for hosts that offer prompts as commands. Off by default. */
  readonly prompts?: boolean;
  readonly skillsExtension?: SkillsExtensionOptions;
}

/**
 * A server with everything registered.
 *
 * The catalog is read on first use rather than here, so a host that connects
 * and never asks pays nothing for the walk.
 */
export function createSkillServer(options: SkillMcpOptions): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  const tools = createSkillTools(options);
  registerSkillsExtension(server, tools.skills, options.skillsExtension);
  registerSkillResources(server, tools.skills);
  if (options.prompts) registerSkillPrompts(server, tools);
  if (options.mailbox) registerMailboxTools(server, options.mailbox);
  return registerSkillTools(server, tools);
}
