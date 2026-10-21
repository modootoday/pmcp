import type { Decision } from "./types.js";
export const denied = (): Decision => ({
  decision: "deny",
  reason: "Shell guard failed validation or execution",
});
export function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}
export function scalar(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  if (value.startsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(value);
      if (typeof parsed === "string") {
        return parsed;
      }
    } catch {
      return value;
    }
  }
  return value;
}
