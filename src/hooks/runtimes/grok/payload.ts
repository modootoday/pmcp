import { isAbsolute, resolve } from "node:path";

import type { HookInput } from "../../contract.js";
import { NEUTRAL_EVENTS, toolKind } from "./events.js";

type Raw = Record<string, unknown>;

function object(value: unknown): Raw {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Raw)
    : {};
}

const text = (value: unknown) =>
  typeof value === "string" ? value : undefined;

// grok sends every field twice, camelCase and snake_case; Claude never sends the camelCase
// sessionId and workspaceRoot, so they tell a grok call made through a Claude projection.
export function claims(payload: unknown): boolean {
  const raw = object(payload);
  return (
    typeof raw["sessionId"] === "string" &&
    typeof raw["workspaceRoot"] === "string"
  );
}

export function normalize(
  nativeEvent: string,
  payload: unknown,
  projectRoot: string,
): HookInput | null {
  const event = NEUTRAL_EVENTS[nativeEvent];
  if (!event) return null;
  const raw = object(payload);
  const cwd = text(raw["cwd"]) ?? text(raw["workspaceRoot"]) ?? projectRoot;
  const name = text(raw["toolName"]) ?? text(raw["tool_name"]);
  const input = object(raw["toolInput"] ?? raw["tool_input"]);
  const kind = name ? toolKind(name) : undefined;
  const path = text(input["file_path"]);
  const paths = path ? [isAbsolute(path) ? path : resolve(cwd, path)] : [];
  const turnId = text(raw["promptId"]);
  const prompt = text(raw["prompt"]);
  const lastMessage = text(raw["lastAssistantMessage"]);
  return {
    contract: 2,
    runtime: "grok",
    event,
    session: {
      id: text(raw["sessionId"]) ?? text(raw["session_id"]) ?? "",
      ...(turnId ? { turnId } : {}),
    },
    cwd,
    projectRoot,
    ...(name && kind
      ? {
          tool: {
            kind,
            native: name,
            ...(kind === "shell"
              ? { command: text(input["command"]) ?? "" }
              : {}),
            paths: kind === "shell" ? [] : paths,
          },
        }
      : {}),
    ...(prompt !== undefined && event === "prompt" ? { prompt } : {}),
    ...(event === "stop"
      ? {
          stop: {
            active: raw["stopHookActive"] === true,
            ...(lastMessage !== undefined ? { lastMessage } : {}),
          },
        }
      : {}),
  };
}
