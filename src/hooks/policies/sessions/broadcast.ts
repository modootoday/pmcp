import {
  NEUTRAL_EVENTS,
  type HookInput,
  type NeutralEvent,
} from "../../contract.js";
import {
  onlyKeys,
  pass,
  stringList,
  type Policy,
  type PolicyContext,
} from "../types.js";

export interface BroadcastOptions {
  readonly deliverOn: readonly NeutralEvent[];
}

const DELIVERABLE: readonly NeutralEvent[] = [
  "session_start",
  "prompt",
  "before_tool",
  "after_tool",
  "stop",
];

// Send Stop context once because each delivery continues the conversation.
function stopAllowed(
  input: HookInput,
  ctx: PolicyContext<BroadcastOptions>,
): boolean {
  if (input.stop?.active) return false;
  const turn = input.session.turnId;
  if (!turn) return false;
  const record = ctx.store.registry.get(input.session.id);
  return record?.stopNoticeTurn !== turn;
}

export const broadcast: Policy<BroadcastOptions> = {
  id: "sessions.broadcast",
  events: DELIVERABLE,
  tools: ["shell", "edit"],
  fail: "open",
  defaultMode: "warn",
  options(raw) {
    onlyKeys(raw, ["keep", "deliver_on"]);
    const deliverOn = stringList(raw, "deliver_on") ?? [
      "session_start",
      "prompt",
      "before_tool",
    ];
    const bad = deliverOn.find(
      (event) =>
        !NEUTRAL_EVENTS.includes(event as NeutralEvent) ||
        !DELIVERABLE.includes(event as NeutralEvent),
    );
    if (bad) throw new Error(`deliver_on cannot include ${bad}`);
    return { deliverOn: deliverOn as NeutralEvent[] };
  },
  eventsFor: (options) => options.deliverOn,
  evaluate(input, ctx) {
    const session = input.session.id;
    if (!session || !ctx.options.deliverOn.includes(input.event)) return pass;
    // With the mailbox on, a broadcast is a message to all and the mailbox delivers it once.
    if (ctx.store.mailbox.settings.enabled) return pass;
    if (input.event === "stop" && !stopAllowed(input, ctx)) return pass;
    const unseen = ctx.store.broadcast.unseen(session);
    if (unseen.length === 0) return pass;
    if (input.event === "stop")
      ctx.store.registry.upsert(session, {
        stopNoticeTurn: input.session.turnId!,
      });
    return {
      context: unseen.map(
        (entry) => `Operator broadcast (${entry.since}): ${entry.text}`,
      ),
    };
  },
};
