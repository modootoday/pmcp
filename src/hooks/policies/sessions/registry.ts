import type { HookInput } from "../../contract.js";
import { runtimePid } from "../../../sessions/liveness.js";
import { ptyFields } from "../../../sessions/wake/pty-ref.js";
import { notifyHost } from "./pty-events.js";
import type { SessionRecord } from "../../../sessions/types.js";
import { noOptions, pass, type Policy } from "../types.js";

const ALL_EVENTS = [
  "session_start",
  "prompt",
  "before_tool",
  "after_tool",
  "stop",
  "session_end",
  "notification",
] as const;

function fields(input: HookInput): Partial<SessionRecord> {
  const cwd = { cwd: input.cwd };
  if (input.event === "session_start")
    return { ...cwd, status: "idle", runtime: input.runtime };
  if (input.event === "prompt")
    return { ...cwd, status: "working", waiting: "" };
  if (input.event === "after_tool") return { ...cwd, status: "working" };
  if (input.event === "notification") {
    const reason = input.notification?.type || input.notification?.message;
    return { status: "waiting", waiting: reason ?? "" };
  }
  if (input.event === "stop") {
    return {
      status: "idle",
      waiting: "",
      lastMessage: (input.stop?.lastMessage ?? "").slice(0, 200),
    };
  }
  const tool = input.tool;
  const action = tool?.command
    ? `${tool.native}: ${tool.command.slice(0, 80)}`
    : (tool?.native ?? "");
  return { ...cwd, status: "working", lastAction: action };
}

// Capture the runtime pid so liveness does not depend only on heartbeat timing.
export const registry: Policy<object> = {
  id: "sessions.registry",
  events: ALL_EVENTS,
  tools: ["shell", "edit"],
  fail: "open",
  defaultMode: "warn",
  options: noOptions,
  evaluate(input, ctx) {
    const session = input.session.id;
    if (!session) return pass;
    if (input.event === "session_end") {
      ctx.store.registry.remove(session);
      return pass;
    }
    const known = ctx.store.registry.get(session);
    const starting =
      known?.pid === undefined || input.event === "session_start";
    const runtime = starting ? runtimePid() : undefined;
    const pid = runtime === undefined ? {} : { pid: runtime };
    // The pmcp-pty host this runtime runs in, when it is the hosted process itself.
    const hosted = runtime === undefined ? {} : ptyFields(process.env, runtime);
    // The policy a session started under, so status can say when it predates the current one.
    const policy =
      starting && ctx.policySha256 ? { startPolicy: ctx.policySha256 } : {};
    const wake = input.session.wakeUrl
      ? { wakeUrl: input.session.wakeUrl }
      : {};
    const record = ctx.store.registry.upsert(session, {
      ...fields(input),
      ...pid,
      ...policy,
      ...wake,
      ...hosted,
    });
    notifyHost(record, input);
    return pass;
  },
};
