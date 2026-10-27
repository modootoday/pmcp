import {
  DEFAULT_RUNTIME_IDS,
  RUNTIME_IDS,
  type RuntimeId,
} from "../contract.js";
import { readFailure } from "../dispatch/failure.js";
import { readReportTable } from "../inspection/report.js";
import { readTestTable } from "../inspection/smoke.js";
import type { HooksTable, Table } from "./types.js";

const KEYS = [
  "targets",
  "ask_fallback",
  "error_log",
  "emergency_off_file",
  "guards",
  "checks",
  "shell",
  "edit",
  "failure",
  "report",
  "test",
];
const LEGACY = new Set(["shell", "edit"]);
const FALLBACKS = ["deny", "warn", "refuse"];

function relativePath(value: unknown, key: string): string | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== "string" ||
    value === "" ||
    value.startsWith("/") ||
    value.split("/").includes("..")
  ) {
    throw new Error(`${key} must be a path inside the project`);
  }
  return value;
}

// Keep the emergency switch outside the repository so a commit cannot change it.
function offFile(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value === "") {
    throw new Error("emergency_off_file must be a path");
  }
  return value;
}

function errorLog(value: unknown): { enabled: boolean; file?: string } {
  if (value === undefined || value === true) return { enabled: true };
  if (value === false) return { enabled: false };
  return { enabled: true, file: relativePath(value, "error_log")! };
}

export function readHooksTable(
  table: Table,
  tools: ReadonlySet<string>,
): HooksTable {
  const unknown = Object.keys(table).find((key) => !KEYS.includes(key));
  if (unknown) throw new Error(`unknown key ${unknown}`);
  const enabled = Object.keys(table).some((key) => !LEGACY.has(key));
  const declared = table["targets"];
  if (
    declared !== undefined &&
    (!Array.isArray(declared) ||
      !declared.every((id) => RUNTIME_IDS.includes(id)))
  ) {
    throw new Error(
      `targets must list runtimes from ${RUNTIME_IDS.join(", ")}`,
    );
  }
  // Newer runtimes are opt-in so adding an adapter never starts projecting into a project unasked.
  const targets =
    (declared as RuntimeId[] | undefined) ??
    DEFAULT_RUNTIME_IDS.filter((id) => tools.has(id));
  const askFallback = table["ask_fallback"] ?? "deny";
  if (typeof askFallback !== "string" || !FALLBACKS.includes(askFallback)) {
    throw new Error(`ask_fallback must be one of ${FALLBACKS.join(", ")}`);
  }
  const log = errorLog(table["error_log"]);
  const emergencyOffFile = offFile(table["emergency_off_file"]);
  const failure = readFailure(table["failure"]);
  // Read by pmcp hooks report and the smoke run alone; checked here so a mistake fails at
  // projection.
  readReportTable(table["report"]);
  readTestTable(table["test"]);
  return {
    enabled,
    targets: [...new Set(targets)],
    askFallback: askFallback as HooksTable["askFallback"],
    logEnabled: log.enabled,
    ...(log.file ? { errorLog: log.file } : {}),
    ...(emergencyOffFile ? { emergencyOffFile } : {}),
    ...(failure ? { failure } : {}),
  };
}
