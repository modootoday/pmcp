import { escape } from "../layout/html.mjs";

export function standing(entry) {
  if (entry.line.status === "active") return "";
  if (entry.line.status === "frozen")
    return `<p class="notice">This ${entry.line.major}.x line is no longer revised. The recorded verification date is historical.</p>`;
  const recall = entry.line.recall;
  if (!recall)
    return '<p class="notice">This line has been recalled. Review the applicable package advisory before use.</p>';
  return `<section class="notice"><h2>This line has been recalled</h2>
    <p>${escape(recall.severity)}: ${escape(recall.summary)}</p>
    <p>The advisory concerns the package versions, not a vulnerability in the skill text.</p>
    <p><a href="${escape(recall.advisoryUrl)}">Read the advisory</a>.</p></section>`;
}
