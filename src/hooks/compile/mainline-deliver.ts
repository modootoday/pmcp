import type { ProjectConfig } from "../../config.js";
import { readGitConfig } from "../../git/config.js";
import type { CompiledGuard } from "../compiled.js";

// Use the git reader so direct-push policy and delivery interpret the same declarations.
export function readMainlineDeliver(
  tables: { readonly git?: unknown; readonly sessions?: unknown },
  root: string,
): CompiledGuard | null {
  if (tables.git === undefined) return null;
  const config = {
    path: "pmcp.toml",
    dir: root,
    raw: { git: tables.git, sessions: tables.sessions },
  } as unknown as ProjectConfig;
  const deliver = readGitConfig(config)?.deliver;
  if (!deliver?.refuseDirectPush) return null;
  return { id: "git.mainline.deliver", mode: "deny", options: {} };
}
