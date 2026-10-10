import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import type { SkillTools } from "../server.js";
import { describeResponseSchema } from "./schemas.js";
import {
  readOnlyTool,
  skillNameInput,
  structured,
  unknownSkill,
} from "./shared.js";

export function registerDescribeTool(
  server: McpServer,
  tools: SkillTools,
): void {
  server.registerTool(
    "skill_describe",
    {
      ...readOnlyTool("Describe a skill"),
      description:
        "One skill's frontmatter, metadata (tier, level, requirements as requires.<name> entries, verified-runtimes, licence, approval), and the files it carries with sizes and sha256, without any body.",
      inputSchema: z.object({ name: skillNameInput }),
      outputSchema: describeResponseSchema,
    },
    async ({ name }) => {
      const described = tools.describe(name);
      return described ? structured(described) : unknownSkill(name);
    },
  );
}
