import type { Runtime } from "../../runtime.js";

export const runtimeExecutables: Readonly<Record<string, string>> = {
  "codex-cli": "codex",
  "claude-code": "claude",
  "gemini-cli": "gemini",
  "grok-cli": "grok",
  antigravity: "agy",
} satisfies Readonly<Record<Runtime, string>>;
