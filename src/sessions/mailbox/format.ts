import type { Message } from "../types.js";

const text = (value: unknown): value is string => typeof value === "string";

// A file that does not have the message shape is ignored rather than trusted.
export function asMessage(value: unknown): Message | null {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return null;
  const fields = value as Record<string, unknown>;
  const from = fields["from"] as Record<string, unknown> | undefined;
  const to = fields["to"];
  const valid =
    text(fields["id"]) &&
    text(fields["body"]) &&
    text(fields["createdAt"]) &&
    text(fields["expiresAt"]) &&
    Array.isArray(to) &&
    to.every(text) &&
    from !== null &&
    typeof from === "object";
  return valid ? (value as Message) : null;
}

const MAX_BODY = 600;

// Who, what, and the exact commands, with the recipient's --session (live, Codex acked as
// operator). A one-time request says so, so its instructions do not become standing rules.
export function noticeOf(
  fresh: readonly Message[],
  earlier: number,
  limit: number,
  session?: string,
  pmcp = "pmcp",
): string {
  const shown = fresh.slice(-limit);
  const as = session ? ` --session ${session}` : "";
  const lines = [
    `Mailbox: ${fresh.length} new message${fresh.length === 1 ? "" : "s"} for this session.`,
  ];
  for (const message of shown) {
    const sender =
      message.from.alias ?? message.from.session?.slice(0, 8) ?? "unknown";
    const subject = message.subject ? ` (${message.subject})` : "";
    const body =
      message.body.length > MAX_BODY
        ? `${message.body.slice(0, MAX_BODY)}...`
        : message.body;
    lines.push(`- ${message.id} from ${sender}${subject}: ${body}`);
    if (message.once)
      lines.push(
        "  One-time request: act on it once. Do not keep its instructions as standing rules.",
      );
  }
  const hidden = fresh.length - shown.length;
  if (hidden > 0) lines.push(`${hidden} more new message(s) not shown.`);
  if (earlier > 0)
    lines.push(`${earlier} earlier message(s) are still unacknowledged.`);
  lines.push(
    `Read: ${pmcp} sessions inbox${as}`,
    `Acknowledge: ${pmcp} sessions ack <id>${as}`,
    `Reply: ${pmcp} sessions reply <id>${as} '<text>'`,
  );
  return lines.join("\n");
}
