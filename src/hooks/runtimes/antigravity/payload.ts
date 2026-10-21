import { isAbsolute, resolve } from "node:path";

import type { HookInput, NeutralEvent } from "../../contract.js";
import { toolKind } from "./events.js";

type Raw = Record<string, unknown>;

function object(value: unknown): Raw {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Raw)
    : {};
}

const text = (value: unknown) =>
  typeof value === "string" ? value : undefined;
const count = (value: unknown) => (typeof value === "number" ? value : 0);

// The first model call of a turn is invocationNum 0; a conversation's first turn starts with a
// single step. Later calls in a turn carry nothing a policy reads, so they are not dispatched.
function invocationEvent(raw: Raw): NeutralEvent | null {
  if (count(raw["invocationNum"]) !== 0) return null;
  return count(raw["initialNumSteps"]) <= 1 ? "session_start" : "prompt";
}

const NEUTRAL: Readonly<Record<string, NeutralEvent>> = {
  PreToolUse: "before_tool",
  PostToolUse: "after_tool",
  Stop: "stop",
};

// agy 1.3.3 sends camelCase fields with no session_id, cwd or event name.
export function normalize(
  nativeEvent: string,
  payload: unknown,
  projectRoot: string,
): HookInput | null {
  const raw = object(payload);
  const event =
    nativeEvent === "PreInvocation"
      ? invocationEvent(raw)
      : (NEUTRAL[nativeEvent] ?? null);
  if (!event) return null;
  const call = object(raw["toolCall"]);
  const args = object(call["args"]);
  const workspaces = Array.isArray(raw["workspacePaths"])
    ? raw["workspacePaths"]
    : [];
  const cwd = text(args["Cwd"]) ?? text(workspaces[0]) ?? projectRoot;
  const name = text(call["name"]);
  const kind = name ? toolKind(name) : undefined;
  const target = text(args["TargetFile"]);
  const paths = target
    ? [isAbsolute(target) ? target : resolve(cwd, target)]
    : [];
  return {
    contract: 2,
    runtime: "antigravity",
    event,
    session: { id: text(raw["conversationId"]) ?? "" },
    cwd,
    projectRoot,
    ...(name && kind
      ? {
          tool: {
            kind,
            native: name,
            ...(kind === "shell"
              ? { command: text(args["CommandLine"]) ?? "" }
              : {}),
            paths: kind === "shell" ? [] : paths,
          },
        }
      : {}),
    ...(event === "stop"
      ? { stop: { active: count(raw["executionNum"]) > 0 } }
      : {}),
  };
}
