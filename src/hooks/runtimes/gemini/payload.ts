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

// Gemini 0.63.0 sends snake_case fields; it has no turn id and no agent type.
export function normalize(
  nativeEvent: string,
  payload: unknown,
  projectRoot: string,
): HookInput | null {
  const event = NEUTRAL_EVENTS[nativeEvent];
  if (!event) return null;
  const raw = object(payload);
  const cwd = text(raw["cwd"]) ?? projectRoot;
  const name = text(raw["tool_name"]);
  const input = object(raw["tool_input"]);
  const kind = name ? toolKind(name) : undefined;
  const paths = [input["file_path"], input["absolute_path"], input["path"]]
    .filter((value): value is string => typeof value === "string" && !!value)
    .map((path) => (isAbsolute(path) ? path : resolve(cwd, path)));
  const prompt = text(raw["prompt"]);
  const lastMessage = text(raw["prompt_response"]);
  return {
    contract: 2,
    runtime: "gemini",
    event,
    session: { id: text(raw["session_id"]) ?? "" },
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
            active: raw["stop_hook_active"] === true,
            ...(lastMessage !== undefined ? { lastMessage } : {}),
          },
        }
      : {}),
  };
}
