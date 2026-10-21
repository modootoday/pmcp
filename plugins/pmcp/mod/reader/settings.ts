import type { UiSettings } from "./types";

export const UI_SETTINGS_FILE = ".agents/pmcp-hooks/ui-claude.json";

const SWITCHES = [
  "sessionsPane",
  "statusBand",
  "commands",
  "holdForeignEdits",
] as const;

function within(root: string, path: string): string {
  if (path.startsWith("/")) return path;
  const parts = root.split("/");
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return parts.join("/");
}

// Disable the mod on unreadable settings so partial configuration cannot activate a broken UI.
export function parseUiSettings(
  source: string,
  projectRoot: string,
): UiSettings | null {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    return null;
  }
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return null;
  const raw = value as Record<string, unknown>;
  const declared = raw.stateDir;
  if (
    declared !== undefined &&
    (typeof declared !== "string" || declared === "")
  )
    return null;
  if (SWITCHES.some((key) => typeof raw[key] !== "boolean")) return null;
  return {
    ...(declared ? { stateDir: within(projectRoot, declared) } : {}),
    sessionsPane: raw.sessionsPane === true,
    statusBand: raw.statusBand === true,
    commands: raw.commands === true,
    holdForeignEdits: raw.holdForeignEdits === true,
  };
}
