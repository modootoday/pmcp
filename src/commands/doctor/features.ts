import type { Ui } from "../../cli/ui.js";
import { RUNTIME_IDS, type RuntimeId } from "../../hooks/contract.js";
import type { FeatureRow } from "../../project/features.js";

// Claude and Codex keep their columns; a newer runtime gets one only when the project targets it.
const ALWAYS: readonly RuntimeId[] = ["claude", "codex"];

export function printFeatures(ui: Ui, rows: readonly FeatureRow[]): void {
  if (rows.length === 0) return;
  const extra = RUNTIME_IDS.filter(
    (id) =>
      !ALWAYS.includes(id) &&
      rows.some((row) => (row.cells?.[id] ?? "-") !== "-"),
  );
  const columns = [
    "feature",
    "enabled",
    "projected",
    "claude",
    "codex",
    "codex trust",
    ...extra,
  ];
  const cells = rows.map((row) => [
    row.feature,
    row.enabled,
    row.projected,
    row.claude,
    row.codex,
    row.codexTrust,
    ...extra.map((id) => row.cells?.[id] ?? "-"),
  ]);
  const widths = columns.map((name, at) =>
    Math.max(name.length, ...cells.map((cell) => cell[at]!.length)),
  );
  const render = (values: readonly string[]) =>
    `  ${values.map((value, at) => value.padEnd(widths[at]!)).join("  ")}`.trimEnd();
  ui.line();
  ui.heading("features");
  ui.line(render(columns));
  cells.forEach((cell) => ui.line(render(cell)));
}
