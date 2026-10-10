import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import type { CallResponse, SkillTools } from "../server.js";
import { resourceLink } from "./content.js";
import { readOnlyTool, unknownSkill } from "./shared.js";

/** The body names its references by relative path; this says they can be fetched. */
function manifest(found: CallResponse): string {
  const lines = found.files.map(
    (file) =>
      `- ${file.path} (${file.bytes} bytes, ${file.mimeType}, sha256 ${file.sha256.slice(0, 12)})`,
  );
  if (found.filesTruncated)
    lines.push("- (list cut; skill_bundle has the rest)");
  return [
    `Files in skill ${found.name}. skill_read returns one by this name and its path; skill_bundle returns every file with its path:`,
    ...lines,
  ].join("\n");
}

export function registerCallTool(server: McpServer, tools: SkillTools): void {
  server.registerTool(
    "skill_call",
    {
      ...readOnlyTool("Read a skill"),
      description:
        "The body of a single skill, by the name skill_find or skill_catalog returned, followed by the list of reference, script and asset files the skill carries, if any, as text and as resource links. This is the only call that costs a document.",
      inputSchema: z.object({
        name: z
          .string()
          .min(1)
          .describe("The skill name, as <package>/<slug>."),
      }),
    },
    async ({ name }) => {
      const found = tools.call(name);
      if (!found) return unknownSkill(name);
      const body = { type: "text" as const, text: found.body };
      if (found.files.length === 0) return { content: [body] };
      return {
        content: [
          body,
          { type: "text" as const, text: manifest(found) },
          ...found.files.map(resourceLink),
        ],
      };
    },
  );
}
