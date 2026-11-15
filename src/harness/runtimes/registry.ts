import {
  EXECUTABLES,
  PRODUCT_OF,
  type ProductName,
} from "../../runtime/ids.js";

// The harness lists its runtimes in this order (capabilities, diagnostics, group checks).
const ORDER: readonly ProductName[] = [
  "codex-cli",
  "claude-code",
  "gemini-cli",
  "grok-cli",
  "antigravity",
];

export const runtimeExecutables: Readonly<Record<string, string>> =
  Object.fromEntries(
    ORDER.map((product) => [product, EXECUTABLES[PRODUCT_OF[product]]]),
  );
