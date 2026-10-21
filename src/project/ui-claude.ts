import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { ConfigError } from "../config.js";
import {
  UI_SETTINGS_FILE,
  type UiSettings,
} from "../ui/claude/reader/index.js";
import type { Finding } from "./doctor/types.js";
import type { Output } from "./outputs.js";
import type { ProjectSpec } from "./spec.js";

const KEYS = {
  sessions_pane: "sessionsPane",
  status_band: "statusBand",
  commands: "commands",
  hold_foreign_edits: "holdForeignEdits",
} as const;

type Key = keyof typeof KEYS;

// Let the hook resolve state location so the mod cannot apply a different path rule.
export function readUiClaude(
  path: string,
  raw: unknown,
  sessionHooks: boolean,
): UiSettings | undefined {
  if (raw === undefined) return undefined;
  if (raw === null || typeof raw !== "object" || Array.isArray(raw))
    throw new ConfigError(path, "[ui] must be a table");
  const claude = (raw as Record<string, unknown>)["claude"];
  if (claude === undefined) return undefined;
  if (claude === null || typeof claude !== "object" || Array.isArray(claude))
    throw new ConfigError(path, "[ui.claude] must be a table");
  const table = claude as Record<string, unknown>;
  const switches: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(table)) {
    if (!(key in KEYS))
      throw new ConfigError(path, `[ui.claude] unknown key ${key}`);
    if (typeof value !== "boolean")
      throw new ConfigError(path, `[ui.claude] ${key} must be a boolean`);
    switches[KEYS[key as Key]] = value;
  }
  if (!sessionHooks)
    throw new ConfigError(
      path,
      "[ui.claude] needs the session hooks: declare [sessions.registry]",
    );
  return {
    sessionsPane: switches["sessionsPane"] ?? true,
    statusBand: switches["statusBand"] ?? true,
    commands: switches["commands"] ?? true,
    holdForeignEdits: switches["holdForeignEdits"] ?? true,
  };
}

const settingsText = (ui: UiSettings) => `${JSON.stringify(ui, null, 2)}\n`;

export function uiClaudeOutputs(spec: ProjectSpec): Output[] {
  if (!spec.uiClaude || !spec.tools.has("claude")) return [];
  return [
    {
      kind: "file",
      path: UI_SETTINGS_FILE,
      content: settingsText(spec.uiClaude),
    },
  ];
}

// Doctor reads only the projected file; whether the host loaded the mod needs a live session.
export function uiClaudeDoctor(spec: ProjectSpec): Finding[] {
  const ui = spec.uiClaude;
  if (!ui) return [];
  const path = join(spec.root, UI_SETTINGS_FILE);
  const current = existsSync(path) ? readFileSync(path, "utf8") : null;
  if (current !== settingsText(ui))
    return [
      {
        tool: "claude",
        check: "ui.claude mod settings",
        status: "fail",
        detail: `${UI_SETTINGS_FILE} does not match [ui.claude]; run pmcp project`,
      },
    ];
  const switches = Object.entries(KEYS).map(
    ([key, field]) => `${key} ${ui[field] ? "on" : "off"}`,
  );
  return [
    {
      tool: "claude",
      check: "ui.claude mod settings",
      status: "ok",
      detail: `${switches.join(", ")}; the mod loads with the pmcp plugin`,
    },
  ];
}
