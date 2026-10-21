import { join } from "node:path";
import type { Tool } from "../spec.js";
import type { RunResult } from "./types.js";
import type { Finding } from "./types.js";
export const missingFrom = (
  names: readonly string[],
  present: (name: string) => boolean,
) => names.filter((name) => !present(name));
export function verdict(
  tool: Tool,
  check: string,
  missing: readonly string[],
): Finding {
  if (missing.length === 0) return { tool, check, status: "ok" };
  return {
    tool,
    check,
    status: "fail",
    detail: `missing: ${missing.join(", ")}`,
  };
}
export function listed(
  tool: Tool,
  check: string,
  result: RunResult,
  names: readonly string[],
  present: (out: string, name: string) => boolean,
): Finding {
  if (result.missing)
    return { tool, check, status: "skip", detail: "not installed" };
  if (result.status !== 0) {
    return {
      tool,
      check,
      status: "fail",
      detail: `exit ${result.status}: ${result.stdout.trim().split("\n").pop() ?? ""}`,
    };
  }
  return verdict(
    tool,
    check,
    missingFrom(names, (name) => present(result.stdout, name)),
  );
}
export const lines = (out: string) => out.split("\n").map((l) => l.trim());
