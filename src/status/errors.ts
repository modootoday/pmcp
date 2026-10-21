import { existsSync } from "node:fs";
import type { ProjectConfig } from "../config.js";
import { readLogs } from "../logging/query.js";
import { logLocation } from "../project/log-location.js";

export function recentErrors(
  config: ProjectConfig,
  env: Readonly<Record<string, string | undefined>>,
  now = Date.now(),
) {
  const location = logLocation(config, env);
  if ("file" in location && location.file && !existsSync(location.file))
    return [];
  return readLogs(
    location.dir,
    { level: "error", since: new Date(now - 3_600_000) },
    location.file,
  ).filter(
    (row) =>
      Number.isFinite(Date.parse(row.ts ?? "")) && Date.parse(row.ts!) <= now,
  );
}
