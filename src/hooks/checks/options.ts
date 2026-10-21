import { isAbsolute } from "node:path";
import { onlyKeys } from "../policies/types.js";
import type { AfterEditOptions, StopOptions } from "./types.js";

function report(raw: Readonly<Record<string, unknown>>): void {
  if (raw["report"] !== undefined && raw["report"] !== "context")
    throw new Error("report must be context");
}

export function afterEditOptions(
  raw: Readonly<Record<string, unknown>>,
): AfterEditOptions {
  onlyKeys(raw, ["validator_glob", "command", "debounce_seconds", "report"]);
  report(raw);
  const glob = raw["validator_glob"];
  const command = raw["command"];
  const seconds = raw["debounce_seconds"] ?? 60;
  if (
    typeof glob !== "string" ||
    !glob ||
    isAbsolute(glob) ||
    glob.split("/").includes("..")
  )
    throw new Error("validator_glob must stay inside the project");
  if (
    !Array.isArray(command) ||
    command.length === 0 ||
    !command.every(
      (part) =>
        typeof part === "string" && part.length > 0 && !part.includes("\0"),
    ) ||
    !command.some((part) => part.includes("{validator}"))
  )
    throw new Error("command must be argv containing {validator}");
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0)
    throw new Error("debounce_seconds must be nonnegative");
  return {
    validatorGlob: glob,
    command: command as string[],
    debounceMs: seconds * 1000,
  };
}

export function stopOptions(
  raw: Readonly<Record<string, unknown>>,
): StopOptions {
  onlyKeys(raw, ["project_check", "report"]);
  report(raw);
  const enabled = raw["project_check"] ?? true;
  if (typeof enabled !== "boolean")
    throw new Error("project_check must be a boolean");
  return { projectCheck: enabled };
}
