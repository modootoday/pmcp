import { relative } from "node:path";
import type { SkillEntry } from "./types.js";
export function withoutBody({
  path,
  ...rest
}: SkillEntry): Omit<SkillEntry, "path"> {
  void path;
  return rest;
}
export function displayPath(root: string, entry: SkillEntry): string {
  return relative(root, entry.path).replaceAll("\\", "/");
}
