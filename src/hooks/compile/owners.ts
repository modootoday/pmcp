import { readOwners } from "../owners.js";
import type { CompiledGuard } from "../compiled.js";

// [[owners]] turns the owners notice on; every entry travels in its options.
export function readOwnersGuard(value: unknown): CompiledGuard | null {
  const entries = readOwners(value);
  if (entries.length === 0) return null;
  return { id: "owners", mode: "warn", options: { entries } };
}
