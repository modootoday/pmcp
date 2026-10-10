import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import { detectRuntime } from "../runtime.js";
import type { SkillTools } from "../server.js";
import { catalogResponseSchema } from "./schemas.js";
import {
  kindInput,
  readOnlyTool,
  runtimeInput,
  structured,
  tierInput,
  verifiedOnlyInput,
} from "./shared.js";

export function registerCatalogTool(
  server: McpServer,
  tools: SkillTools,
): void {
  server.registerTool(
    "skill_catalog",
    {
      ...readOnlyTool("List skills"),
      description:
        "Every skill the installed packages and marketplaces ship, grouped by package or plugin, with names, one-line descriptions and tier, and no bodies. Paged by group. With kind it lists agents, hooks or MCP servers instead. Items list the runtimes they were verified on (verifiedRuntimes). With runtime, verified items are marked and listed first within their group but the others are kept; verifiedOnly drops the unverified ones.",
      inputSchema: z.object({
        page: z.number().int().min(1).optional(),
        pageSize: z.number().int().min(1).max(20).optional(),
        tier: tierInput,
        kind: kindInput,
        runtime: runtimeInput,
        verifiedOnly: verifiedOnlyInput,
      }),
      outputSchema: catalogResponseSchema,
    },
    async (request, ctx) =>
      structured(
        tools.catalog({
          ...request,
          clientRuntime: detectRuntime(server, ctx),
        }),
      ),
  );
}
