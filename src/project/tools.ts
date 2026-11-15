import type { RuntimeId } from "../runtime/ids.js";

// The order pmcp project writes each runtime's outputs in.
export const TOOLS = [
  "claude",
  "codex",
  "gemini",
  "grok",
  "antigravity",
  "opencode",
] as const satisfies readonly RuntimeId[];
export type Tool = (typeof TOOLS)[number];
