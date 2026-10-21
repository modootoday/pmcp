// Keep prompt hashes instead of text so events can be correlated without exposing prompts.

import { createHash } from "node:crypto";

import type { RedactKind } from "./settings.js";

const SECRET_KEY = /secret|token|password|passwd|credential|api[_-]?key/iu;
const ENV_KEY = /^(env|environment)$/iu;
const PROMPT_KEY = /^(prompt|lastMessage|last_message)$/u;
const ALL: readonly RedactKind[] = [
  "secret_values",
  "prompt_text",
  "env_values",
];

export function redact(
  value: unknown,
  kinds: readonly RedactKind[] = ALL,
  key = "",
): unknown {
  if (kinds.includes("secret_values") && SECRET_KEY.test(key))
    return "[redacted]";
  if (kinds.includes("env_values") && ENV_KEY.test(key)) return "[redacted]";
  if (
    kinds.includes("prompt_text") &&
    PROMPT_KEY.test(key) &&
    typeof value === "string"
  ) {
    return {
      length: value.length,
      sha256: createHash("sha256").update(value).digest("hex").slice(0, 16),
    };
  }
  if (Array.isArray(value)) return value.map((item) => redact(item, kinds));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([name, item]) => [
        name,
        redact(item, kinds, name),
      ]),
    );
  }
  return value;
}
