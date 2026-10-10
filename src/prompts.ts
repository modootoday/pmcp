/**
 * One prompt per skill, for hosts that offer prompts as commands: the Agent
 * Skills "user-explicit activation" path. Off unless the host asks for it,
 * because the list grows with the catalog.
 */

import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import { kindOf, type SkillEntry } from "./catalog.js";
import type { SkillTools } from "./server.js";

/** Prompt names travel into host command names, so they stay to a plain set. */
export const promptName = (entry: Pick<SkillEntry, "name">): string =>
  entry.name.replace(/^@/u, "").replace(/[^A-Za-z0-9_-]+/gu, "-");

function messageText(tools: SkillTools, name: string, task?: string): string {
  const found = tools.call(name);
  if (!found) return `The skill ${name} is no longer in this catalog.`;
  const files = found.files.map((file) => `- ${file.path}`);
  const parts = [found.body];
  if (files.length > 0)
    parts.push(
      `Files in skill ${found.name} (skill_read returns each by path):\n${files.join("\n")}`,
    );
  if (task) parts.push(`Task: ${task}`);
  return parts.join("\n\n");
}

export function registerSkillPrompts(
  server: McpServer,
  tools: SkillTools,
): void {
  const taken = new Set<string>();
  for (const entry of tools.skills()) {
    if (kindOf(entry) !== "skill") continue;
    const name = promptName(entry);
    if (taken.has(name)) continue;
    taken.add(name);
    server.registerPrompt(
      name,
      {
        title: entry.name,
        description: entry.description,
        argsSchema: z.object({
          task: z.string().optional().describe("What to apply the skill to."),
        }),
      },
      ({ task }) => ({
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: messageText(tools, entry.name, task),
            },
          },
        ],
      }),
    );
  }
}
