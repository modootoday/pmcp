import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import type { SkillTools } from "../server.js";
import { resourceLink } from "./content.js";
import { bundleResponseSchema } from "./schemas.js";
import { readOnlyTool, skillNameInput, unknownSkill } from "./shared.js";

export function registerBundleTool(server: McpServer, tools: SkillTools): void {
  server.registerTool(
    "skill_bundle",
    {
      ...readOnlyTool("List a skill's files"),
      description:
        "Every file of one skill with its path relative to the skill directory, size, media type and sha256, as resource links that resources/read returns. The bytes are not included in this result. Used to write a skill to a local skills directory.",
      inputSchema: z.object({ name: skillNameInput }),
      outputSchema: bundleResponseSchema,
    },
    async ({ name }) => {
      const bundle = tools.bundle(name);
      if (!bundle) return unknownSkill(name);
      const value = { ...bundle, files: [...bundle.files] };
      return {
        content: [
          { type: "text" as const, text: JSON.stringify(value, null, 2) },
          ...bundle.files.map(resourceLink),
        ],
        structuredContent: value,
      };
    },
  );
}
