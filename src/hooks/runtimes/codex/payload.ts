import { isAbsolute, resolve } from "node:path";

import type { HookInput } from "../../contract.js";
import { NEUTRAL_EVENTS, toolKind } from "./events.js";

type Raw = Record<string, unknown>;

const PATCH_HEADER =
  /^\*\*\* (?:Update File|Add File|Delete File|Move to): (.+)$/gmu;

function object(value: unknown): Raw {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Raw)
    : {};
}

const text = (value: unknown) =>
  typeof value === "string" ? value : undefined;

export function patchPaths(patch: string): string[] {
  return [...patch.matchAll(PATCH_HEADER)].map((match) => match[1]!.trim());
}

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
  const body = text(toolInput["command"]) ?? "";
  const paths = (kind === "edit" ? patchPaths(body) : [])
    .filter(Boolean)
    .map((path) => (isAbsolute(path) ? path : resolve(cwd, path)));
  const turnId = text(raw["turn_id"]);
  const lastMessage = text(raw["last_assistant_message"]);
  const prompt = text(raw["prompt"]);
  return {
    contract: 2,
    runtime: "codex",
    event,
    session: {
      id: text(raw["session_id"]) ?? "",
      ...(turnId ? { turnId } : {}),
    },
    cwd,
    projectRoot,
    ...toolFields(name, kind, body, paths),
    ...(prompt !== undefined ? { prompt } : {}),
    ...stopFields(event, raw, lastMessage),
  };
}

function toolFields(
  name: string | undefined,
  kind: NonNullable<HookInput["tool"]>["kind"] | undefined,
  body: string,
  paths: string[],
): Pick<HookInput, "tool"> {
  if (!name || !kind) return {};
  return {
    tool: {
      kind,
      native: name,
      ...(kind === "shell" || kind === "edit" ? { command: body } : {}),
      paths,
    },
  };
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
