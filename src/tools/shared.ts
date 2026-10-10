/** What every tool shares: its annotations and the shape of its answers. */

import { z } from "zod";

import { runtimeSchema } from "./schemas.js";

const readOnly = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

// Hosts differ on where they read a tool's display name: Claude's directory reads
// annotations.title and ignores the top-level one, so both carry the same words.
export const readOnlyTool = (title: string) => ({
  title,
  annotations: { ...readOnly, title },
});

export const kindInput = z
  .enum(["skill", "agent", "hook", "mcp", "any"])
  .optional()
  .describe(
    "skill (default), agent, hook, mcp, or any. Commands are skills; agents, hooks and MCP servers are installed with pmcp add rather than read.",
  );

export const tierInput = z
  .enum(["open", "free", "paid", "internal"])
  .optional();

export const runtimeInput = runtimeSchema
  .optional()
  .describe(
    "A runtime (claude-code, codex-cli, gemini-cli, grok-cli, antigravity). Skills whose metadata.verified-runtimes lists it are marked verified and listed first; the rest are kept. Without it, the order is the same as without verification data.",
  );

export const verifiedOnlyInput = z
  .boolean()
  .optional()
  .describe(
    "Drop skills that are not verified: on the given runtime, or on any runtime when none is given. The detected client runtime never filters.",
  );

export const skillNameInput = z
  .string()
  .min(1)
  .describe("A skill name as skill_find or skill_catalog returns it.");

export const asText = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
});

/** JSON for older clients, and the same value as structuredContent for newer ones. */
export const structured = <T extends object>(value: T) => ({
  ...asText(value),
  structuredContent: { ...value } as Record<string, unknown>,
});

/** An error result carries no structuredContent: there is no schema it could match. */
export const unknownSkill = (name: string) => ({
  ...asText({
    error: "unknown_skill",
    name,
    hint: "skill_catalog lists the names that exist.",
  }),
  isError: true,
});
