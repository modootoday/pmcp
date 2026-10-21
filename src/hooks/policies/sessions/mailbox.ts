import { noticeOf } from "../../../sessions/mailbox/format.js";
import { inboxKey } from "../../../sessions/mailbox/select.js";
import { pmcpCommand } from "../../../sessions/projector-cli.js";
import { ptyRef } from "../../../sessions/wake/pty-ref.js";
import type { Recipient } from "../../../sessions/types.js";
import type { HookInput } from "../../contract.js";
import { pass, type Policy, type PolicyContext } from "../types.js";

export interface MailboxOptions {
  // Role name to the agent type that holds it, from [sessions.roles].
  readonly roles: Readonly<Record<string, string>>;
}

function rolesOf(
  agentType: string | undefined,
  options: MailboxOptions,
): string[] {
  if (!agentType) return [];
  const named = Object.entries(options.roles)
    .filter(([, type]) => agentType === type || agentType.endsWith(`:${type}`))
    .map(([name]) => name);
  return [...new Set([...named, agentType.split(":").at(-1)!])];
}

function recipientOf(
  input: HookInput,
  ctx: PolicyContext<MailboxOptions>,
): Recipient {
  const session = input.session.id;
  const record = ctx.store.registry.get(session);
  const roles = rolesOf(input.session.agentType, ctx.options);
  // Remember the roles so pmcp sessions inbox --session can resolve role selectors too.
  if (
    roles.length > 0 &&
    JSON.stringify(record?.["roles"]) !== JSON.stringify(roles)
  )
    ctx.store.registry.upsert(session, { roles });
  return {
    key: inboxKey({ session }),
    session,
    ...(record?.alias ? { alias: record.alias } : {}),
    roles,
    desk: record?.worktree || input.cwd,
    // The registry records a session at its start, so earlier broadcasts are not its news.
    ...(record?.startedAt ? { since: record.startedAt } : {}),
  };
}

const WAKE_PREFIX = "pmcp mail:";

// A session hosted by pmcp-pty gets mail only on the wake turn that announces it: as context on
// any other prompt, the notice took over turns pmcp-pty sent (grok and agy answered mail first).
function heldForWake(
  input: HookInput,
  ctx: PolicyContext<MailboxOptions>,
): boolean {
  const record = ctx.store.registry.get(input.session.id);
  if (!record || !ptyRef(record)) return false;
  const wake =
    input.event === "prompt" &&
    (input.prompt ?? "").trimStart().startsWith(WAKE_PREFIX);
  return !wake;
}

// Delivers each unacknowledged message to a session once; a later event notices only messages
// that arrived since. Delivery is recorded, never taken as an acknowledgement. Context a runtime
// does not show at this event is held by dispatch for the next one that does.
export const mailbox: Policy<MailboxOptions> = {
  id: "sessions.mailbox",
  events: ["session_start", "prompt", "before_tool", "after_tool"],
  fail: "open",
  defaultMode: "warn",
  options(raw) {
    const roles = (raw["roles"] ?? {}) as Record<string, unknown>;
    return {
      roles: Object.fromEntries(
        Object.entries(roles).map(([name, value]) => {
          const type = (value as Record<string, unknown> | null)?.[
            "agent_type"
          ];
          return [name, typeof type === "string" ? type : name];
        }),
      ),
    };
  },
  evaluate(input, ctx) {
    const box = ctx.store.mailbox;
    if (!input.session.id || !box.settings.enabled) return pass;
    if (heldForWake(input, ctx)) return pass;
    const recipient = recipientOf(input, ctx);
    const unacked = box.inbox(recipient, Date.now());
    const fresh = unacked.filter(
      (message) => !box.delivered(recipient.key, message.id),
    );
    if (fresh.length === 0) return pass;
    box.markDelivered(
      recipient.key,
      fresh.map((message) => message.id),
    );
    const broadcasts = fresh
      .map((message) => message.broadcastId)
      .filter(Boolean);
    // Keep seenBroadcast moving so status and the Claude band read delivered broadcasts as seen.
    if (broadcasts.length > 0)
      ctx.store.registry.upsert(input.session.id, {
        seenBroadcast: broadcasts.sort((a, b) => Number(a) - Number(b)).at(-1)!,
      });
    return {
      context: [
        noticeOf(
          fresh,
          unacked.length - fresh.length,
          box.settings.maxDelivered,
          input.session.id,
          // The hook runs with the session's PATH, so this is the pmcp its shell would find.
          pmcpCommand(input.projectRoot, ctx.store.dir, process.env["PATH"]),
        ),
      ],
    };
  },
};
