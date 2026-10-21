import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

import type { Finding } from "./types.js";

const MAX_BYTES = 1024 * 1024;

export function readDenyList(path: string): string[] {
  return readFileSync(path, "utf8")
    .split("\n")
    .map((line) => line.trim().toLowerCase())
    .filter((line) => line !== "" && !line.startsWith("#"));
}

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return filesUnder(path);
    return entry.isFile() ? [path] : [];
  });
}

// Report line numbers because deny-list terms may be private while reports are published.
export function denyListFindings(
  skillMd: string,
  denyList: string | undefined,
): Finding[] {
  if (denyList === undefined) return [];
  if (!existsSync(denyList))
    return [
      { path: denyList, reason: "deny_list file not found", level: "error" },
    ];
  const terms = readDenyList(denyList);
  const findings: Finding[] = [];
  for (const file of filesUnder(dirname(skillMd))) {
    if (statSync(file).size > MAX_BYTES) continue;
    const text = readFileSync(file, "utf8").toLowerCase();
    terms.forEach((term, index) => {
      if (!text.includes(term)) return;
      findings.push({
        path: file,
        reason: `contains deny-list entry ${index + 1}`,
        level: "error",
      });
    });
  }
  return findings;
}
