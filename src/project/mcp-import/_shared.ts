import { stringify } from "smol-toml";
import { readMcp } from "../mcp-spec.js";
import { ProjectError } from "../package-rules.js";
import type { Table } from "./types.js";
export function object(value: unknown): Table {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ProjectError(
      "MCP source must contain object-valued server entries",
    );
  }
  return value as Table;
}
export function equivalent(alias: string, left: Table, right: Table): boolean {
  return (
    JSON.stringify(readMcp("import", { [alias]: left })[alias]) ===
    JSON.stringify(readMcp("import", { [alias]: right })[alias])
  );
}
