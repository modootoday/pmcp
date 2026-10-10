import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import type { SkillTools } from "../server.js";
import { fileBlock } from "./content.js";
import { asText, readOnlyTool, skillNameInput } from "./shared.js";

export function registerReadTool(server: McpServer, tools: SkillTools): void {
  server.registerTool(
    "skill_read",
    {
      ...readOnlyTool("Read a skill file"),
      description:
        "One file inside a skill's directory in this catalog, with its sha256 and media type: text as text, images and audio as image and audio content, other binary files as an embedded resource. path is relative to the skill, as skill_call, skill_bundle and skill_describe list it (layout: https://pmcp.build). Scripts are returned as content, never run, and no external API is called. Files over 256 KiB and paths outside the skill are refused.",
      inputSchema: z.object({
        name: skillNameInput,
        path: z
          .string()
          .min(1)
          .optional()
          .describe(
            "Path relative to the skill directory. Defaults to SKILL.md.",
          ),
      }),
    },
    async ({ name, path }) => {
      const result = tools.read(name, path);
      if (!result.ok) return { ...asText(result), isError: true };
      const { text: _text, blob: _blob, ...header } = result;
      return {
        content: [
          { type: "text" as const, text: JSON.stringify(header) },
          fileBlock(result),
        ],
      };
    },
  );
}
