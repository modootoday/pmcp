import { isAbsolute, resolve } from "node:path";

import type { EditRequest, HookInput } from "../../contract.js";
import { NEUTRAL_EVENTS, toolKind } from "./events.js";

type Raw = Record<string, unknown>;

function object(value: unknown): Raw {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Raw)
    : {};
}

const text = (value: unknown) =>
  typeof value === "string" ? value : undefined;

export function normalize(
  nativeEvent: string,
  payload: unknown,
  projectRoot: string,
): HookInput | null {
  const event = NEUTRAL_EVENTS[nativeEvent];
  const raw = object(payload);
  if (!event) return null;
  const cwd = text(raw["cwd"]) ?? projectRoot;
  const name = text(raw["tool_name"]);
  const toolInput = object(raw["tool_input"]);
  const kind = name ? toolKind(name) : undefined;
  const paths = [
    toolInput["file_path"],
    toolInput["notebook_path"],
    kind === "read" ? toolInput["path"] : undefined,
  ]
    .filter((value): value is string => typeof value === "string" && !!value)
    .map((path) => (isAbsolute(path) ? path : resolve(cwd, path)));
  const agentType = text(raw["agent_type"]);
  const turnId = text(raw["prompt_id"]);
  const lastMessage = text(raw["last_assistant_message"]);
  const prompt = text(raw["prompt"]);
  return {
    contract: 2,
    runtime: "claude",
    event,
    session: {
      id: text(raw["session_id"]) ?? "",
      ...(agentType ? { agentType } : {}),
      ...(turnId ? { turnId } : {}),
    },
    cwd,
    projectRoot,
    ...toolFields(name, kind, toolInput, paths),
    ...(prompt !== undefined ? { prompt } : {}),
    ...stopFields(event, raw, lastMessage),
    ...notificationFields(event, raw),
  };
}

// Claude sends idle_prompt as a Notification too; the type keeps it apart from a real question.
function notificationFields(
  event: HookInput["event"],
  raw: Raw,
): Pick<HookInput, "notification"> {
  if (event !== "notification") return {};
  const type = text(raw["notification_type"]);
  const message = text(raw["message"]);
  return {
    notification: {
      ...(type ? { type } : {}),
      ...(message ? { message } : {}),
    },
  };
}

function toolFields(
  name: string | undefined,
  kind: NonNullable<HookInput["tool"]>["kind"] | undefined,
  input: Raw,
  paths: string[],
): Pick<HookInput, "tool"> {
  if (!name || !kind) return {};
  return {
    tool: {
      kind,
      native: name,
      ...(kind === "shell" ? { command: text(input["command"]) ?? "" } : {}),
      paths,
      ...editFields(name, input, paths),
    },
  };
}

type Replacement = NonNullable<EditRequest["replacements"]>[number];

function replacement(value: unknown): Replacement | null {
  const item = object(value);
  const old = text(item["old_string"]);
  const next = text(item["new_string"]);
  if (old === undefined || next === undefined) return null;
  return { old, new: next, all: item["replace_all"] === true };
}

// Write carries the whole text; Edit and MultiEdit carry replacements in the current file.
function editFields(
  name: string,
  input: Raw,
  paths: readonly string[],
): { edit?: EditRequest } {
  const path = paths[0];
  if (path === undefined) return {};
  if (name === "Write") {
    const content = text(input["content"]);
    return content === undefined ? {} : { edit: { path, content } };
  }
  const list =
    name === "Edit"
      ? [replacement(input)]
      : name === "MultiEdit" && Array.isArray(input["edits"])
        ? (input["edits"] as unknown[]).map(replacement)
        : null;
  if (list === null || list.length === 0 || list.some((item) => !item))
    return {};
  return { edit: { path, replacements: list as Replacement[] } };
}

function stopFields(
  event: HookInput["event"],
  raw: Raw,
  lastMessage: string | undefined,
): Pick<HookInput, "stop"> {
  if (event !== "stop") return {};
  return {
    stop: {
      active: raw["stop_hook_active"] === true,
      ...(lastMessage !== undefined ? { lastMessage } : {}),
    },
  };
}
