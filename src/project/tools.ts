export const TOOLS = [
  "claude",
  "codex",
  "gemini",
  "grok",
  "antigravity",
  "opencode",
] as const;
export type Tool = (typeof TOOLS)[number];
