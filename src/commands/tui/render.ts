import type { Ui } from "../../cli/ui.js";

// A receipt read by a person: one "key: value" line per field, nested values indented.
export function renderReceipt(ui: Ui, receipt: unknown, indent = ""): void {
  if (receipt === null || typeof receipt !== "object") {
    ui.line(`${indent}${String(receipt)}`);
    return;
  }
  const entries = Array.isArray(receipt)
    ? receipt.map((value, index) => [String(index + 1), value] as const)
    : Object.entries(receipt);
  for (const [key, value] of entries) {
    if (value !== null && typeof value === "object") {
      ui.line(`${indent}${key}:`);
      renderReceipt(ui, value, `${indent}  `);
      continue;
    }
    ui.line(`${indent}${key}: ${String(value)}`);
  }
}
