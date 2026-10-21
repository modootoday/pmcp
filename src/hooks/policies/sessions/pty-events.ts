import { createConnection } from "node:net";

import { ptyRef } from "../../../sessions/wake/pty-ref.js";
import type { SessionRecord } from "../../../sessions/types.js";
import type { HookInput } from "../../contract.js";

// A runtime hosted by pmcp-pty tells its host when a turn starts and ends, with the last
// assistant message: the host ends a turn on that before trusting the screen, which need not
// show a turn started elsewhere. Best effort, so a host that is gone never slows a hook.
const TIMEOUT_MS = 500;

function kindOf(input: HookInput): string | null {
  if (input.event === "session_start") return "session_start";
  if (input.event === "prompt") return "turn_start";
  if (input.event === "stop") return "turn_end";
  const note = `${input.notification?.type ?? ""} ${input.notification?.message ?? ""}`;
  if (input.event === "notification" && /permission/iu.test(note))
    return "permission";
  return null;
}

function messageOf(input: HookInput): string | undefined {
  if (input.event === "stop") return input.stop?.lastMessage ?? "";
  if (input.event === "notification") return input.notification?.message;
  return undefined;
}

// The hook process ends only after this write settles, since the runner sets exitCode.
export function notifyHost(
  record: SessionRecord | null,
  input: HookInput,
): void {
  const ref = record ? ptyRef(record) : null;
  const kind = kindOf(input);
  if (!ref || !kind) return;
  const line = JSON.stringify({
    op: "event",
    id: ref.session,
    kind,
    message: messageOf(input),
    session: input.session.id,
    expect: { instance: ref.instance },
  });
  const client = createConnection(ref.socket);
  client.setTimeout(TIMEOUT_MS, () => client.destroy());
  client.on("error", () => client.destroy());
  client.on("connect", () => client.end(`${line}\n`));
}
