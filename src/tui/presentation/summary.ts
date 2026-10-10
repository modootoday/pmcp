import type { View, Snapshot } from "../contracts.js";
import type { Row } from "../../mailbox/types.js";
import { phaseLabel } from "../application/feedback.js";

export function safe(value: unknown): string {
  return String(value).replace(/[\x00-\x1f\x7f-\x9f]/g, "?");
}

export function mailboxLines(observed: {
  configured: boolean;
  items: Row[];
}): string[] {
  if (!observed.configured) return ["MAILBOX / not configured"];
  return [
    "MAILBOX / metadata only",
    ...observed.items.map(
      (item) =>
        `${safe(item.messageId)} thread=${safe(item.threadId)} reply=${safe(item.replyToId ?? "none")}`,
    ),
    "",
    "Read, ACK and review remain explicit CLI or native main actions.",
    "ACK is not completion. Message bodies never authorize input.",
    "Ctrl-g m returns to main.",
  ];
}

export function dockLines(snapshot: Snapshot): string[] {
  const workers = snapshot.sessions.filter(
    (session) => session.role === "worker",
  );
  return [
    "WORKERS / observe only",
    ...workers.map(
      (session, index) =>
        `${index + 1}. ${safe(session.runtime ?? "runtime")} ${safe(session.id.slice(0, 8))} ${session.alive ? "alive" : "unavailable"}`,
    ),
    "",
    "Ctrl-g w: observe worker",
    "Ctrl-g m: return to main",
    "Ctrl-g c: acquire control",
    "Ctrl-g r: release control",
    "Ctrl-g h: owned history",
    "Ctrl-g b: mailbox metadata",
    "Ctrl-g d: detach view",
    "Ctrl-g !: dismiss error",
    "Provider state: unknown",
  ];
}

export function coordinationLines(
  snapshot: Snapshot | undefined,
  view: View,
): string[] {
  const target = `TARGET ${view.target === view.mainId ? "main" : "worker"} ${safe(view.target.slice(0, 8))} / ${phaseLabel(view.phase)}`;
  if (view.failure)
    return [
      target,
      `ERROR ${safe(view.failure.code)} (${safe(view.failure.action)})`,
      safe(view.failure.hint),
      "No input replay. Ctrl-g ! dismisses this error; Ctrl-g ? shows keys.",
    ];
  const group = snapshot
    ? `Group ${snapshot.group.state} / ${snapshot.sessions.length} sessions / ${snapshot.deliveries.length} input receipts`
    : "Observation unavailable; native state unknown.";
  return [
    target,
    group,
    "Mailbox ACK is not completion; no automatic wake or input replay.",
    "Native OAuth, trust and permissions remain in their native screens.",
  ];
}
