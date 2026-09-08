/**
 * The three tools, spoken over MCP.
 *
 * Thin on purpose: every decision is in `createSkillTools`, and this file only
 * names the tools and shapes their arguments. A consumer that wants the same
 * three operations from a hook or a script uses the tools directly and never
 * speaks a protocol.
 */

import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import {
  createSkillTools,
  type SkillServerOptions,
  type SkillTools,
} from "./server.js";

/** Reported to the host on connect. */
export const SERVER_NAME = "pmcp";

const readOnly = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

const asText = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
});

/**
 * Registers the three tools on a server.
 *
 * Exported separately from the stdio entry so a consumer already running an MCP
 * server can add these to it rather than starting a second process.
 */
export function registerSkillTools(
  server: McpServer,
  tools: SkillTools,
): McpServer {
  server.registerTool(
    "skill_catalog",
    {
      title: "List installed skills without their bodies",
      description:
        "Every skill the installed packages ship, grouped by package, with names and one-line descriptions and no bodies. Use it to see what exists, or when skill_find returns nothing.",
      inputSchema: z.object({}),
      annotations: readOnly,
    },
    async () => asText(tools.catalog()),
  );

  server.registerTool(
    "skill_find",
    {
      title: "Find skills by describing the problem",
      description:
        "Ranked skill names for an intent. Describe the problem in a full sentence in English rather than a keyword: a single word matches far worse, and the ranking is over descriptions. Returns names only -- read one with skill_call.",
      inputSchema: z.object({
        intent: z
          .string()
          .min(1)
          .max(256)
          .describe("What you are trying to do, as an English sentence."),
        limit: z.number().int().min(1).max(25).optional(),
      }),
      annotations: readOnly,
    },
    async ({ intent, limit }) => asText(await tools.find(intent, limit)),
  );

  server.registerTool(
    "skill_call",
    {
      title: "Read one skill",
      description:
        "The body of a single skill, by the name skill_find or skill_catalog returned. This is the only call that costs a document.",
      inputSchema: z.object({
        name: z
          .string()
          .min(1)
          .describe("The skill name, as <package>/<slug>."),
      }),
      annotations: readOnly,
    },
    async ({ name }) => {
      const found = tools.call(name);
      if (!found) {
        return {
          ...asText({
            error: "unknown_skill",
            name,
            hint: "Call skill_catalog for the names that exist.",
          }),
          isError: true,
        };
      }
      return { content: [{ type: "text" as const, text: found.body }] };
    },
  );

  return server;
}

/**
 * A server with the three tools registered.
 *
 * The catalog is read on first use rather than here, so a host that connects
 * and never asks pays nothing for the walk.
 */
export function createSkillServer(options: SkillServerOptions): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: "0.1.3" });
  return registerSkillTools(server, createSkillTools(options));
}
