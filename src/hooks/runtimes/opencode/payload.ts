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

// The plugin forwards each hook's recorded shape, adding the plugin's directory: tool hooks send
// {input, args}, chat.message {input}, and bus events {type, properties}.
export function normalize(
  nativeEvent: string,
  payload: unknown,
  projectRoot: string,
): HookInput | null {
  const event = NEUTRAL_EVENTS[nativeEvent];
  if (!event) return null;
  const raw = object(payload);
  const input = object(raw["input"]);
  const properties = object(raw["properties"]);
  const cwd = text(raw["directory"]) ?? projectRoot;
  const name = text(input["tool"]);
  const args = object(raw["args"] ?? input["args"]);
  const kind = name ? toolKind(name) : undefined;
  const path = text(args["filePath"]);
  const paths = path ? [isAbsolute(path) ? path : resolve(cwd, path)] : [];
  const session =
    text(input["sessionID"]) ?? text(properties["sessionID"]) ?? "";
  return {
    contract: 2,
    runtime: "opencode",
    event,
    session: {
      id: session,
      ...(text(raw["serverUrl"]) ? { wakeUrl: text(raw["serverUrl"])! } : {}),
    },
    cwd,
    projectRoot,
    ...(name && kind
      ? {
          tool: {
            kind,
            native: name,
            ...(kind === "shell"
              ? { command: text(args["command"]) ?? "" }
              : {}),
            paths: kind === "shell" ? [] : paths,
          },
        }
      : {}),
    ...(event === "stop" ? { stop: { active: false } } : {}),
  };
}
