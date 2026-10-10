import type { View } from "../contracts.js";
import { phaseLabel } from "../application/feedback.js";

export function targetStatus(view: View): string {
  const role = view.target === view.mainId ? "MAIN" : "WORKER";
  const phase = view.phase === "read-only" ? "OBSERVE" : phaseLabel(view.phase);
  const input = view.phase === "controlled" ? "INPUT ON" : "INPUT OFF";
  return `${role} ${view.target.slice(0, 8)} | ${phase} | ${input}`;
}
