import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import { detectRuntime } from "../runtime.js";
import type { SkillTools } from "../server.js";
import { findResultSchema } from "./schemas.js";
import {
  kindInput,
  readOnlyTool,
  runtimeInput,
  structured,
  tierInput,
  verifiedOnlyInput,
} from "./shared.js";

export function registerFindTool(server: McpServer, tools: SkillTools): void {
  server.registerTool(
    "skill_find",
    {
      ...readOnlyTool("Find skills"),
      description:
        "Skill names ranked against an intent, with descriptions and scores, and no bodies. The ranking compares the intent with skill descriptions, so a full sentence matches better than a single keyword. Each match lists the runtimes it was verified on (verifiedRuntimes). With runtime, verified matches are marked and listed first but the others are kept; verifiedOnly drops the unverified ones. The answer's runtime is the one the ordering used, or null.",
      inputSchema: z.object({
        intent: z
          .string()
          .min(1)
          .max(256)
          .describe("What the task is, as a sentence."),
        limit: z.number().int().min(1).max(25).optional(),
        runtime: runtimeInput,
        verifiedOnly: verifiedOnlyInput,
        filters: z
          .object({
            kind: kindInput,
            tier: tierInput,
            package: z.string().optional(),
            level: z.string().optional(),
            domain: z.string().optional(),
            medium: z.string().optional(),
          })
          .optional()
          .describe("Exact-match filters over the catalog before ranking."),
      }),
      outputSchema: findResultSchema,
    },
    async ({ intent, limit, runtime, verifiedOnly, filters }, ctx) =>
      structured(
        await tools.find(
          intent,
          limit,
          { ...filters, runtime, verifiedOnly },
          detectRuntime(server, ctx),
        ),
      ),
  );
}
